const express = require('express');
const http = require('http');
const cors = require('cors');

const ConfigManager = require('./ConfigManager');
const DatabaseManager = require('./DatabaseManager');
const AlertManager = require('./AlertManager');
const TelemetryHub = require('./TelemetryHub');
const logger = require('./utils/logger');

/**
 * Class ServerApp
 * Kelas utama yang mengatur berjalannya aplikasi backend Node.js (Express & Socket.io).
 * Berperan sebagai jembatan antara Agent (PC Studio) dan Dashboard (UI Admin).
 */
class ServerApp {
  /**
   * Konstruktor inisiasi Server HTTP.
   * @param {number} port - Port jaringan yang akan digunakan (default 4000).
   */
  constructor(port = 4000) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Inisialisasi Modul-Modul Inti (Roda Gigi Utama Server)
    this.configManager = new ConfigManager();
    this.dbManager = new DatabaseManager();
    
    // AlertManager butuh akses ke Config (untuk token) & DB (untuk simpan log)
    this.alertManager = new AlertManager(this.configManager, this.dbManager);
      this.dbManager.autoCleanup(this.configManager.config.logRetentionDays || 30);
    
    // TelemetryHub mengatur lalu-lintas WebSocket
    this.telemetryHub = new TelemetryHub(this.server, this.configManager, this.alertManager);

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Menyiapkan middleware Express (CORS, Parser JSON, Keamanan PIN, dan Statik Server).
   */
  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Middleware Keamanan PIN khusus rute /api (Dashboard)
    // Endpoint /internal/ tidak memerlukan PIN karena digunakan untuk komunikasi mesin-ke-mesin (Agent -> Server)
    this.app.use('/api', (req, res, next) => {
      if (['POST', 'DELETE', 'PUT'].includes(req.method)) {
        const pin = req.headers['x-pin'];
        const correctPin = this.configManager.config.dashboardPin || '1234';
        if (pin !== correctPin) {
          return res.status(401).json({ success: false, error: 'Unauthorized', message: 'PIN Salah' });
        }
      }
      next();
    });
    
    // Menyajikan antarmuka Dashboard (React Build) agar bisa diakses via Browser (http://localhost:4000)
    const path = require('path');
    const dashboardPath = path.join(__dirname, '../dashboard-dist');
    this.app.use(express.static(dashboardPath));

    // Menyajikan folder rekaman agar bisa diakses browser via /media/...
    const os = require('os');
    this.app.use('/media', (req, res, next) => {
      const recordDir = path.resolve(
        this.configManager.config.recordDir || 
        path.join(os.homedir(), 'Documents', 'AudioMonitor-Recordings-Server')
      );
      
      let decodedPath = '';
      try {
        decodedPath = decodeURIComponent(req.path);
      } catch (err) {
        return res.status(400).send('Bad Request: Malformed URI');
      }

      const fullPath = path.resolve(recordDir, '.' + decodedPath);
      
      // Strict path traversal protection
      const rel = path.relative(recordDir, fullPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return res.status(403).send('Forbidden');
      }
      
      res.sendFile(fullPath, (err) => {
        if (err && !res.headersSent && err.code !== 'ECONNABORTED' && err.status !== 304) {
          res.status(404).send('File not found');
        }
      });
    });
  }

  /**
   * Mendaftarkan seluruh rute (endpoints) API HTTP.
   * Digunakan oleh Dashboard untuk mengubah pengaturan atau mengambil data riwayat.
   */
  setupRoutes() {
    
    // Internal API: Menerima file rekaman audio dari Agent
    this.app.post('/internal/upload-record', (req, res) => {
      const agentName = req.headers['x-agent-name'] || 'UnknownAgent';
      const rawSessionFolder = req.headers['x-session-folder'] || 'UnknownSession';
      const rawFileName = req.headers['x-file-name'] || 'UnknownFile.webm';
      
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      
      // Sanitize path components
      const sessionFolder = path.basename(rawSessionFolder);
      const fileName = path.basename(rawFileName);

      const baseDir = path.resolve(
        this.configManager.config.recordDir || 
        path.join(os.homedir(), 'Documents', 'AudioMonitor-Recordings-Server')
      );
      const targetDir = path.join(baseDir, sessionFolder);
      
      try {
        // Jika sessionFolder memiliki akhiran waktu stop (_to_...), gabungkan file dari folder sebelum di-rename jika ada
        if (sessionFolder.includes('_to_')) {
          const baseSessionFolder = sessionFolder.replace(/_to_\d{2}-\d{2}-\d{2}$/i, '');
          const oldDir = path.join(baseDir, baseSessionFolder);
          if (fs.existsSync(oldDir) && oldDir !== targetDir) {
            try {
              if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
              }
              const oldFiles = fs.readdirSync(oldDir);
              for (const f of oldFiles) {
                const oldFilePath = path.join(oldDir, f);
                const newFilePath = path.join(targetDir, f);
                fs.renameSync(oldFilePath, newFilePath);
              }
              try { fs.rmdirSync(oldDir); } catch(e) {}
            } catch(mergeErr) {
              logger.warn(`[Upload] Gagal menggabungkan folder sesi lama: ${mergeErr.message}`);
            }
          }
        }

        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        
        const filePath = path.join(targetDir, fileName);
        const writeStream = fs.createWriteStream(filePath);
        
        let responded = false;
        const sendResponse = (statusCode, payload) => {
          if (!responded && !res.headersSent) {
            responded = true;
            res.status(statusCode).json(payload);
          }
        };

        req.pipe(writeStream);
        
        writeStream.on('finish', () => {
          logger.info(`[Upload] Berhasil menerima file rekaman dari ${agentName}: ${fileName} -> ${filePath}`);
          sendResponse(200, { success: true, message: 'Upload selesai', path: filePath });
        });
        
        writeStream.on('error', (err) => {
          logger.error(`[Upload] Gagal menulis file rekaman dari ${agentName}: ${err.message}`);
          sendResponse(500, { success: false, error: err.message });
        });
        
        req.on('error', (err) => {
          logger.error(`[Upload] Gagal menerima file rekaman dari ${agentName}: ${err.message}`);
          writeStream.close();
          sendResponse(500, { success: false, error: err.message });
        });
      } catch (err) {
        logger.error(`[Upload] Error initializing stream: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Mengambil log harian dari file log
    this.app.get('/api/logs', (req, res) => {
      const logger = require('./utils/logger');
      res.send({ success: true, logs: logger.getTodayLogs() });
    });
    
    // API: Menghapus sebuah PC (Agent) dari daftar Dashboard
    this.app.delete('/api/pc/:uuid', (req, res) => {
      // Validasi PIN sekali lagi untuk proteksi ganda (meski sudah ada middleware)
      const pin = req.headers['x-pin'];
      const correctPin = this.configManager.config.dashboardPin || '1234';
      if (!pin || pin !== correctPin) {
        return res.status(401).json({ error: 'Invalid PIN' });
      }
      const { uuid } = req.params;
      this.telemetryHub.deleteAgent(uuid);
      if (this.configManager.config.pcMapping) {
        delete this.configManager.config.pcMapping[uuid];
      }
      this.configManager.saveConfig();
      res.json({ success: true });
    });
    
    // API: Mengubah nama alias PC
    this.app.post('/api/rename', (req, res) => {
      const { uuid, newName } = req.body;
      if (!uuid || !newName) return res.status(400).send({ success: false, error: 'Invalid data' });
      
      this.configManager.setPcName(uuid, newName);
        
      // Memberitahu PC tujuan agar mengganti nama lokalnya di layar aplikasinya
      this.telemetryHub.notifyAgentNameChange(uuid, newName);
      
      // Memperbarui memori Server & menyebarkan nama baru ke seluruh layar Dashboard admin lainnya
      const existing = this.telemetryHub.lastKnownState.get(uuid) || {};
      existing.pcName = newName;
      this.telemetryHub.lastKnownState.set(uuid, existing);
      this.telemetryHub.io.to('dashboards').emit('dashboard-update', existing);

      res.send({ success: true, pcMapping: this.configManager.getAllPcMappings() });
    });

    // API: Mengambil data JSON seluruh konfigurasi server
    this.app.get('/api/config', (req, res) => {
      res.send(this.configManager.config);
    });

    // API: Mengambil riwayat insiden dengan filter opsional (tanggal, PC, status)
    this.app.get('/api/incidents', (req, res) => {
      const { startDate, endDate, pcName, status, limit } = req.query;
      const hasFilters = startDate || endDate || pcName || status;
      
      if (hasFilters) {
        this.dbManager.getFilteredIncidents({ startDate, endDate, pcName, status, limit }, (rows) => {
          res.send(rows);
        });
      } else {
        this.dbManager.getRecentIncidents(parseInt(limit) || 500, (rows) => {
          res.send(rows);
        });
      }
    });

    // API: Mengambil daftar unik nama PC yang pernah tercatat insiden
    this.app.get('/api/incidents/pc-names', (req, res) => {
      res.send(this.dbManager.getUniquePcNames());
    });

    // API: Menghapus seluruh riwayat insiden
    this.app.delete('/api/incidents', (req, res) => {
      this.dbManager.clearIncidents((err) => {
        if (err) return res.status(500).send({ success: false, error: err.message });
        res.send({ success: true });
      });
    });

    // API: Mengambil daftar file rekaman
    this.app.get('/api/records', (req, res) => {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const recordDir = this.configManager.config.recordDir || path.join(os.homedir(), 'Documents', 'AudioMonitor-Recordings-Server');
      
      const records = [];
      if (fs.existsSync(recordDir)) {
        try {
          const pcFolders = fs.readdirSync(recordDir);
          for (const pc of pcFolders) {
            try {
              const pcPath = path.join(recordDir, pc);
              const pcStat = fs.statSync(pcPath);
              if (!pcStat.isDirectory()) continue;

              const files = fs.readdirSync(pcPath);
              for (const file of files) {
                try {
                  const filePath = path.join(pcPath, file);
                  const stat = fs.statSync(filePath);
                  if (!stat.isFile()) continue;

                  // Regex match folder: PC_Testing_3365df9b-62ec-46ed-8644-83db7d225868_2026-08-29_00-48-53_to_00-49-02
                  const match = pc.match(/^(.*)_([a-f0-9\-]{36})_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})(?:_to_(\d{2}-\d{2}-\d{2}))?$/i);
                  let realPcName = pc;
                  let uuid = '';
                  let isParsed = false;
                  let isCompleted = false;
                  let baseSessionKey = pc;
                  let dateStr = '';
                  let timeStr = '';
                  
                  if (match) {
                    const pcNamePart = match[1];
                    uuid = match[2];
                    const datePart = match[3];
                    const startTime = match[4].replace(/-/g, ':');
                    const endTime = match[5] ? match[5].replace(/-/g, ':') : 'Berlanjut...';
                    isCompleted = !!match[5];
                    baseSessionKey = `${uuid}_${datePart}_${match[4]}`;
                    
                    realPcName = (this.configManager.getPcName ? this.configManager.getPcName(uuid) : this.configManager.config.pcMapping?.[uuid]) || pcNamePart.replace(/_/g, ' ') || uuid;
                    dateStr = datePart;
                    timeStr = `${startTime} - ${endTime}`;
                    isParsed = true;
                  }

                  records.push({
                    folderName: pc, // original folder name for URL construction
                    baseSessionKey,
                    isCompleted,
                    pcName: realPcName,
                    uuid,
                    isParsed,
                    dateStr,
                    timeStr,
                    fileName: file,
                    size: stat.size,
                    createdAt: stat.birthtime && stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime,
                    url: `/media/${encodeURIComponent(pc)}/${encodeURIComponent(file)}`
                  });
                } catch (fileErr) {
                  logger.warn(`Gagal membaca file rekaman ${file}: ${fileErr.message}`);
                }
              }
            } catch (folderErr) {
              logger.warn(`Gagal membaca folder rekaman ${pc}: ${folderErr.message}`);
            }
          }
        } catch(e) {
          logger.error("Error reading records directory", e);
        }
      }
      
      // Urutkan dari yang terbaru
      records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.json(records);
    });

    // API: Hapus file rekaman tunggal
    this.app.delete('/api/records', (req, res) => {
      const { pcName, fileName } = req.body || {};
      if (!pcName || !fileName) return res.status(400).send({ success: false, error: 'Bad Request' });
      
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const recordDir = this.configManager.config.recordDir || path.join(os.homedir(), 'Documents', 'AudioMonitor-Recordings-Server');
      
      // Mencegah path traversal attack
      const safePcName = path.basename(pcName);
      const safeFileName = path.basename(fileName);
      
      const filePath = path.join(recordDir, safePcName, safeFileName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          res.json({ success: true });
        } catch (e) {
          res.status(500).json({ success: false, error: e.message });
        }
      } else {
        res.status(404).json({ success: false, error: 'File not found' });
      }
    });

    // API: Menyimpan pengaturan kunci (Token & Chat ID) Telegram
    this.app.post('/api/config/telegram', (req, res) => {
      const { token, chatId, interval, logRetentionDays } = req.body || {};
      if (logRetentionDays !== undefined) {
        let parsedRetention = parseInt(logRetentionDays, 10);
        if (isNaN(parsedRetention) || parsedRetention <= 0) parsedRetention = 30;
        this.configManager.config.logRetentionDays = parsedRetention;
        this.dbManager.autoCleanup(this.configManager.config.logRetentionDays);
      }
      if (token !== undefined) this.configManager.config.telegram.token = token;
      if (chatId !== undefined) this.configManager.config.telegram.chatId = chatId;
      if (interval !== undefined) {
        const parsedInterval = parseInt(interval, 10);
        if (!isNaN(parsedInterval)) {
          this.configManager.config.telegram.interval = parsedInterval;
        }
      }
      this.configManager.saveConfig();
      
      try {
          this.alertManager.initBot(); 
        } catch (err) {
          console.error('Failed to init bot:', err);
        }
      
      // Sebarkan kunci Telegram yang baru ke semua PC Agent sebagai cadangan darurat (Fallback Offline)
      this.telemetryHub.io.to('agents').emit('telegram-config', this.configManager.getTelegramConfig());
      
      res.send({ success: true, telegram: this.configManager.config.telegram });
    });

    // API: Mematikan/Menyalakan seluruh aktivitas pemantauan secara global
    this.app.post('/api/config/monitoring', (req, res) => {
      const { active } = req.body;
      this.configManager.config.monitoringActive = active;
      this.configManager.saveConfig();
      this.telemetryHub.io.emit('monitoring-status', active); // Umumkan ke seluruh klien
      res.send({ success: true, monitoringActive: active });
    });

    // API: Mengubah PIN akses Dashboard
    this.app.post('/api/config/pin', (req, res) => {
      const { newPin } = req.body;
      if (!newPin || newPin.length < 4) return res.status(400).json({ error: 'PIN minimal 4 karakter' });
      this.configManager.config.dashboardPin = newPin;
      this.configManager.saveConfig();
      res.send({ success: true });
    });

    // API: Mematikan/Menyalakan pemantauan untuk satu PC secara spesifik
    this.app.post('/api/pc/:uuid/monitoring', (req, res) => {
      const { uuid } = req.params;
      const { active } = req.body;
      
      // Mengubah status di memori pusat dan meneruskannya ke Agent dan Dashboard
      this.telemetryHub.setPcMonitoring(uuid, active);
      
      res.send({ success: true, active });
    });

    // API: Mengirim pesan percobaan Telegram ("Ping!")
    this.app.post('/api/telegram/test', (req, res) => {
      this.alertManager.sendTelegramAlert('[TEST] <b>Ping!</b> Ini adalah pesan percobaan dari AudioMonitor Server.');
      res.json({ success: true, message: 'Test message sent' });
    });
  }

  /**
   * Menghidupkan pendengar (Listener) HTTP Server di port yang telah ditentukan.
   */
  start(onError) {
    this.server.on('error', (e) => {
      if (onError) onError(e);
      else logger.error('Server error:', e);
    });
    this.server.listen(this.port, () => {
      logger.info(`Central Server running on port ${this.port}`);
    });
  }
}

module.exports = ServerApp;
