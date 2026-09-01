const { Server } = require('socket.io');
const logger = require('./utils/logger');

/**
 * Class TelemetryHub
 * Pusat komando lalu lintas data (WebSocket) Server.
 * Menangani koneksi dari puluhan PC Agent (pengirim) dan memantulkan (broadcast)
 * data tersebut ke semua UI Dashboard (penerima) yang sedang terbuka secara real-time.
 */
class TelemetryHub {
  /**
   * Konstruktor inisialisasi Socket.io.
   */
  constructor(httpServer, configManager, alertManager) {
    this.configManager = configManager;
    this.alertManager = alertManager;
    
    // State memori untuk mencatat apakah suatu PC sedang dipantau (ON) atau diabaikan (OFF)
    this.pcMonitoringState = {};
    
    // Kamus koneksi Socket.io (UUID -> SocketID)
    this.agentSockets = new Map();
    
    // Menyimpan snapshot status terakhir setiap PC, agar saat Dashboard baru dibuka,
    // Dashboard langsung mendapatkan data terkini tanpa perlu menunggu kiriman telemetry berikutnya.
    this.lastKnownState = new Map();
    
    // Pre-populate memori dengan data PC yang sudah tersimpan di file config
    for (const [uuid, pcName] of Object.entries(this.configManager.config.pcMapping || {})) {
      this.lastKnownState.set(uuid, { uuid, pcName, status: 'OFFLINE', lastSeen: null });
    }
    
    this.io = new Server(httpServer, {
      cors: { origin: '*' } // Mengizinkan Dashboard (jika dijalankan terpisah/Dev Mode) untuk terkoneksi
    });

    // Hubungkan stream logger server ke semua Dashboard yang terkoneksi
    this.unsubscribeLogger = logger.subscribe((logEntry) => {
      try {
        this.io.to('dashboards').emit('system_log', logEntry);
      } catch (e) {}
    });

    this.setupListeners();
  }

  /**
   * Mendaftarkan semua penangkap (Event Listeners) Socket.io untuk lalu lintas data masuk.
   */
  setupListeners() {
    this.io.on('connection', (socket) => {
      logger.debug('A client connected: ' + socket.id);

      // Event saat klien (Agent/Dashboard) pertama kali mengidentifikasi diri
      socket.on('register', (data) => {
        if (data && data.type === 'dashboard') {
          // Masukkan ke ruangan khusus Dashboard
          socket.join('dashboards');
          logger.info(`[Socket] Dashboard terhubung (Socket ID: ${socket.id})`);
          
          // Kirimkan state konfigurasi monitoring global
          socket.emit('monitoring-status', this.configManager.config.monitoringActive !== false);
          
          // Kirimkan state konfigurasi monitoring per-PC
          socket.emit('pc-monitoring-states', this.pcMonitoringState);
          
          // Kirimkan snapshot seluruh PC saat ini agar UI langsung terisi
          socket.emit('all-agents-state', Array.from(this.lastKnownState.values()));
        } else if (data && data.type === 'agent' && data.uuid) {
          // Masukkan Agent ke ruangan khususnya sendiri agar server bisa 'berbisik' ke PC ini
          socket.join(`agent-${data.uuid}`);
          socket.join('agents'); // Ruangan gabungan semua Agent
          
          const configuredName = this.configManager.config.pcMapping?.[data.uuid];
          const candidateName = (data.name && typeof data.name === 'string' && data.name.trim() !== '' && data.name !== data.uuid) ? data.name.trim() : null;
          const pcName = configuredName || candidateName || data.uuid;

          socket.agentUuid = data.uuid;
          socket.agentName = pcName;
          this.agentSockets.set(data.uuid, socket.id);

          // Jika PC belum memiliki mapping nama di server dan Agent mengirimkan nama yang valid, daftarkan otomatis
          if (!configuredName && candidateName) {
            this.configManager.setPcName(data.uuid, candidateName);
          }
          
          // Jika PC ini sebelumnya berstatus OFF, beri tahu agar mematikan monitoringnya
          const stored = this.pcMonitoringState[data.uuid];
          if (stored !== undefined) {
            socket.emit('set-monitoring', stored);
          }
          
          // Kirimkan token Telegram cadangan ke PC ini
          socket.emit('telegram-config', this.configManager.getTelegramConfig());
          logger.info(`[Socket] PC Host terhubung dan terdaftar: ${pcName} (${data.uuid})`);
        }
      });

      // Event saat Agent mengirimkan data status terbarunya (Volume, dB, CPU, Status Bahaya)
      socket.on('telemetry', (data) => {
        if (!data || !data.uuid) return;
        socket.agentUuid = data.uuid;
        socket.agentName = data.name;
        this.agentSockets.set(data.uuid, socket.id);
        
        // Pastikan socket agent tergabung dalam room agar selalu menerima perintah remote update & config
        const agentRoom = `agent-${data.uuid}`;
        if (!socket.rooms.has(agentRoom)) socket.join(agentRoom);
        if (!socket.rooms.has('agents')) socket.join('agents');

        // Memproses data dan menyebarkannya ke semua Dashboard
        this.handleTelemetry(data);
      });

      // Event saat Dashboard mengubah pengaturan khusus Agent (Remote Config)
      socket.on('agent-config-update', (data) => {
        if (!data || !data.uuid || !data.config) return;
        
        // Jika nama PC juga diganti melalui form tersebut, simpan perubahannya
        if (data.config.agentName) {
          this.configManager.setPcName(data.uuid, data.config.agentName);
          const existing = this.lastKnownState.get(data.uuid) || {};
          existing.pcName = data.config.agentName;
          this.lastKnownState.set(data.uuid, existing);
          
          // Beri tahu Dashboard lain bahwa nama PC ini berubah
          this.io.to('dashboards').emit('dashboard-update', existing);
        }

        // Teruskan data setelan baru ini ke ruang khusus PC
        this.io.to('agent-' + data.uuid).emit('update-config', data.config);
        logger.info(`[RemoteConfig] Konfigurasi baru disiarkan ke PC ${data.uuid}`);
      });

      // Event usang (Legacy) saat Dashboard sekadar mengubah nama PC
      socket.on('agent-rename', (data) => { if (!data) return;
          if (data.uuid && data.newName) {
            this.configManager.setPcName(data.uuid, data.newName);
            this.notifyAgentNameChange(data.uuid, data.newName);
            const existing = this.lastKnownState.get(data.uuid) || {};
            existing.pcName = data.newName;
            this.lastKnownState.set(data.uuid, existing);
            this.io.to('dashboards').emit('dashboard-update', existing);
          }
      });

      socket.on('agent-record', (data) => {
        if (!data || !data.uuid) return;
        this.io.to('agent-' + data.uuid).emit('command-record', !!data.record);
        logger.info(`[RemoteControl] Mengirim perintah rekam ke PC ${data.uuid}: ${data.record ? 'MULAI REKAM' : 'HENTIKAN REKAM'}`);
      });

        // Event saat Agent melaporkan progres pengunduhan/instalasi update
        socket.on('agent-update-progress', (data) => {
          if (!data) return;
          const enriched = typeof data === 'object' ? { uuid: socket.agentUuid, ...data } : data;
          this.io.to('dashboards').emit('agent-update-progress', enriched);
        });

        // Event saat Agent selesai mengeksekusi pembersihan file audio lokal
        socket.on('agent-storage-cleaned', (data) => {
          if (!data) return;
          const pcName = this.configManager.getPcName(data.uuid || socket.agentUuid) || socket.agentName || 'PC Host';
          logger.info(`[StorageHub] PC Host ${pcName} (${data.uuid || socket.agentUuid}) membersihkan ${data.freedMb} MB storage lokal (${data.deletedFolders} folder dihapus, ${data.skippedUnuploaded || 0} dilindungi).`);
          this.io.to('dashboards').emit('agent-storage-cleaned-result', {
            uuid: data.uuid || socket.agentUuid,
            pcName,
            ...data
          });
        });

        // Event saat Agent melaporkan log sistem (Error, Warning, Audio Event)
        socket.on('agent_log', (data) => {
          if (!data || !data.message) return;
          const pcName = this.configManager.getPcName(data.uuid || socket.agentUuid) || socket.agentName || 'PC Host';
          const level = data.level || 'INFO';
          logger.writeLog(level, `[Agent:${pcName}] ${data.message}`);
        });

        // Event usang (Legacy) via socket untuk toggle monitoring PC
      socket.on('agent-monitoring', (data) => { if (!data) return;
        if (data.uuid && data.active !== undefined) {
          this.setPcMonitoring(data.uuid, data.active);
        }
      });

      // Event saat koneksi klien terputus (Internet mati/Aplikasi ditutup)
      socket.on('disconnect', () => {
        logger.debug('Client disconnected: ' + socket.id);
        
        // Jika yang putus adalah PC Agent (bukan Dashboard)
        if (socket.agentUuid) {
          // Hanya hapus jika socket ini memang koneksi aktif yang terbaru
          if (this.agentSockets.get(socket.agentUuid) === socket.id) {
            this.agentSockets.delete(socket.agentUuid);
            const configuredName = this.configManager.config.pcMapping?.[socket.agentUuid];
            const pcName = configuredName || socket.agentName || socket.agentUuid;
            
            const existing = this.lastKnownState.get(socket.agentUuid) || {};
            const offlineData = { ...existing, uuid: socket.agentUuid, pcName, status: 'OFFLINE', lastSeen: Date.now() };
            
            // Simpan status barunya sebagai OFFLINE
            this.lastKnownState.set(socket.agentUuid, offlineData);

            // Umumkan ke seluruh layar Dashboard agar kotak PC tersebut berubah jadi gelap (OFFLINE)
            this.io.to('dashboards').emit('agent-disconnect', offlineData);
            logger.warn(`[Socket] PC Host terputus (Disconnect): ${pcName} (${socket.agentUuid})`);
            
            // Kirimkan notifikasi ke Telegram (Jika opsi pemantauan tidak sedang dimatikan secara manual)
            const globalActive = this.configManager.config.monitoringActive !== false;
            const pcActive = this.pcMonitoringState[socket.agentUuid] !== false;
            if (globalActive && pcActive) {
              this.alertManager.processOffline(socket.agentUuid, pcName);
            }
          }
        }
      });
    });
  }

  /**
   * Menghapus PC dari memori Server (dipanggil saat tombol Trash diklik di Dashboard).
   */
  deleteAgent(uuid) {
    this.lastKnownState.delete(uuid);
    this.agentSockets.delete(uuid);
    delete this.pcMonitoringState[uuid];
    this.io.to('dashboards').emit('agent-deleted', uuid);
    logger.info(`[TelemetryHub] Menghapus data memori untuk PC ${uuid}`);
  }

  /**
   * Mengirim perintah pergantian nama langsung ke PC Agent.
   */
  notifyAgentNameChange(uuid, newName) {
    const socketId = this.agentSockets.get(uuid);
    if (socketId) {
      this.io.to(socketId).emit('command-rename', newName);
    } else {
      this.io.to(`agent-${uuid}`).emit('command-rename', newName);
    }
  }

  /**
   * Mengubah status pemantauan (ON/OFF) untuk PC tertentu dan memberitahu pihak terkait.
   */
  setPcMonitoring(uuid, active) {
    this.pcMonitoringState[uuid] = active;
    
    // Beri tahu Agent via room agar berhenti berkedip/menganalisa jika OFF
    this.io.to(`agent-${uuid}`).emit('set-monitoring', active);
    
    // Beri tahu Dashboard agar warna tombolnya berubah merah/hijau
    this.io.to('dashboards').emit('pc-monitoring-update', { uuid, active });
  }

  /**
   * Menangani data telemetri yang baru masuk dari Agent.
   * Melakukan validasi, pencatatan insiden ke DB, dan penyebaran ke Dashboard & Telegram.
   */
  handleTelemetry(data) {
    if (!data || !data.uuid) return;
    const configuredName = this.configManager.config.pcMapping?.[data.uuid];
    const candidateName = (data.name && typeof data.name === 'string' && data.name.trim() !== '' && data.name !== data.uuid) ? data.name.trim() : null;
    const pcName = configuredName || candidateName || data.uuid;

    // Jika PC belum memiliki mapping nama di server dan Agent mengirimkan nama yang valid, daftarkan otomatis
    if (!configuredName && candidateName) {
      this.configManager.setPcName(data.uuid, candidateName);
    }
    
    // Inisialisasi atau sinkronisasi status pengawasan per-PC
    if (this.pcMonitoringState[data.uuid] === undefined && data.isMonitoringActive !== undefined) {
      this.pcMonitoringState[data.uuid] = data.isMonitoringActive;
    }

    const isMonitoringActive = this.pcMonitoringState[data.uuid] !== undefined 
      ? this.pcMonitoringState[data.uuid] 
      : (data.isMonitoringActive !== undefined ? data.isMonitoringActive : true);
    
    const enrichedData = {
      ...data,
      pcName,
      name: pcName,
      isMonitoringActive,
      lastSeen: Date.now()
    };
    
    // Simpan untuk Dashboard yang baru dibuka nanti
    this.lastKnownState.set(data.uuid, enrichedData);

    // Kirimkan data ke seluruh Dashboard yang sedang terbuka
    this.io.to('dashboards').emit('dashboard-update', enrichedData);

    // Proses Peringatan Telegram (Hanya jika sistem pengawasan sedang ON)
    const globalActive = this.configManager.config.monitoringActive !== false;
    if (globalActive && isMonitoringActive) {
      this.alertManager.processTelemetry(data, pcName);
    }
  }

  /**
   * Memicu proses download dan instalasi pembaruan ke PC Agent.
   */
  triggerAgentUpdate(targetUuid, downloadUrl) {
    if (!downloadUrl) return;
    if (targetUuid === 'all') {
      this.io.to('agents').emit('execute-update', { downloadUrl });
    } else {
      this.io.to(`agent-${targetUuid}`).emit('execute-update', { downloadUrl });
    }
  }

  /**
   * Memicu pembersihan file audio lokal pada PC Host lewat Agent.
   */
  triggerAgentStorageClean(targetUuid = 'all', options = {}) {
    const payload = {
      deleteMode: options.deleteMode || 'all',
      days: typeof options.days === 'number' ? options.days : 0,
      onlyUploaded: options.onlyUploaded !== false
    };
    if (targetUuid === 'all') {
      this.io.to('agents').emit('clean-local-storage', payload);
    } else {
      this.io.to(`agent-${targetUuid}`).emit('clean-local-storage', payload);
    }
  }
}

module.exports = TelemetryHub;
