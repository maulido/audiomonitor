const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ConfigManager = require('./ConfigManager');
const DatabaseManager = require('./DatabaseManager');
const AlertManager = require('./AlertManager');
const TelemetryHub = require('./TelemetryHub');
const TranscriptionManager = require('./TranscriptionManager');
const StorageAutomationManager = require('./StorageAutomationManager');
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
  constructor(configManagerOrPort = 4000, dbManager = null, alertManager = null, port = 4000) {
    if (typeof configManagerOrPort === 'object' && configManagerOrPort !== null) {
      this.port = typeof port === 'number' ? port : 4000;
      this.configManager = configManagerOrPort;
      this.dbManager = dbManager || new DatabaseManager();
      this.alertManager = alertManager || new AlertManager(this.configManager, this.dbManager);
    } else {
      this.port = typeof configManagerOrPort === 'number' ? configManagerOrPort : 4000;
      this.configManager = new ConfigManager();
      this.dbManager = new DatabaseManager();
      this.alertManager = new AlertManager(this.configManager, this.dbManager);
    }
    this.app = express();
    this.server = http.createServer(this.app);
    
    this.dbManager.autoCleanup(this.configManager.config.logRetentionDays || 30);
    
    // TelemetryHub mengatur lalu-lintas WebSocket
    this.telemetryHub = new TelemetryHub(this.server, this.configManager, this.alertManager);

    // TranscriptionManager mengelola integrasi Speech-to-Text Whisper
    this.transcriptionManager = new TranscriptionManager(this.configManager, this.dbManager, this.alertManager, this.telemetryHub);

    // StorageAutomationManager mengelola Smart Storage, Archiving, dan Cloud / NAS Sync
    this.storageAutomationManager = new StorageAutomationManager(this.configManager, this.dbManager);

    // In-Memory Cache untuk optimasi /api/records
    this._recordsCache = null;
    this._recordsCacheTime = 0;
    this._recordsCacheTtlMs = 3000;
    this._recordsCacheVersion = 1;

    // Tracker proteksi brute-force PIN
    this._failedPinAttempts = new Map();

    // Hook invalidasi cache otomatis saat transkripsi selesai
    if (this.transcriptionManager) {
      this.transcriptionManager.onTranscriptionComplete = () => {
        this.invalidateRecordsCache();
      };
    }

    this.setupMiddleware();
    this.setupRoutes();
    this.startPeriodicMaintenance();
  }

  /**
   * Menjalankan pemeliharaan background berkala (auto-cleanup insiden database, auto-purge audio lawas, dan auto-archive).
   */
  startPeriodicMaintenance() {
    if (this._maintenanceTimer) return;
    this._maintenanceTimer = setInterval(async () => {
      try {
        const recordsDir = this.getRecordsDir();
        const retentionDays = this.configManager.config.logRetentionDays || 30;
        this.dbManager.autoCleanup(retentionDays);

        if (this.storageAutomationManager) {
          const autoPurgeRes = await this.storageAutomationManager.runAutoPurgeRawAudio(recordsDir);
          if (autoPurgeRes && autoPurgeRes.purgedSessions > 0) {
            this.invalidateRecordsCache();
          }
          await this.storageAutomationManager.runAutoArchive(recordsDir);
        }
      } catch (err) {
        logger.error(`[Maintenance] Error running periodic maintenance: ${err.message}`);
      }
    }, 3600000); // Setiap 1 jam

    if (this._maintenanceTimer.unref) {
      this._maintenanceTimer.unref();
    }
  }

  /**
   * Mengosongkan cache in-memory data rekaman saat terjadi perubahan data (upload, delete, purge, transkrip).
   */
  invalidateRecordsCache() {
    this._recordsCache = null;
    this._recordsCacheTime = 0;
    this._recordsCacheVersion = (this._recordsCacheVersion || 1) + 1;
  }

  /**
   * Menyiapkan middleware Express (CORS, Parser JSON, Keamanan PIN, dan Statik Server).
   */
  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());

    // Middleware Kompresi Gzip Bawaan (Node.js zlib) untuk menghemat bandwidth LAN dan mempercepat respons
    const zlib = require('zlib');
    this.app.use((req, res, next) => {
      const accept = req.headers['accept-encoding'] || '';
      if (!accept.includes('gzip') || req.path.startsWith('/media') || req.path.startsWith('/updates')) {
        return next();
      }

      const origSend = res.send;
      const origJson = res.json;

      res.send = function (body) {
        if (req.method === 'HEAD' || res.statusCode === 204 || res.statusCode === 304 || res.headersSent) {
          return origSend.call(this, body);
        }
        if (typeof body === 'string' && body.length > 1024 && !res.getHeader('Content-Encoding')) {
          res.setHeader('Content-Encoding', 'gzip');
          const gzipped = zlib.gzipSync(Buffer.from(body, 'utf8'));
          return origSend.call(this, gzipped);
        } else if (Buffer.isBuffer(body) && body.length > 1024 && !res.getHeader('Content-Encoding')) {
          res.setHeader('Content-Encoding', 'gzip');
          const gzipped = zlib.gzipSync(body);
          return origSend.call(this, gzipped);
        }
        return origSend.call(this, body);
      };

      res.json = function (obj) {
        if (req.method === 'HEAD' || res.statusCode === 204 || res.statusCode === 304 || res.headersSent) {
          return origJson.call(this, obj);
        }
        const jsonStr = JSON.stringify(obj);
        if (jsonStr && jsonStr.length > 1024 && !res.getHeader('Content-Encoding')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Content-Encoding', 'gzip');
          const gzipped = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'));
          return origSend.call(this, gzipped);
        }
        return origJson.call(this, obj);
      };

      next();
    });
    
    // Middleware Keamanan PIN khusus rute /api (Dashboard)
    // Endpoint /internal/ tidak memerlukan PIN karena digunakan untuk komunikasi mesin-ke-mesin (Agent -> Server)
    this.app.use('/api', (req, res, next) => {
      if (['POST', 'DELETE', 'PUT'].includes(req.method)) {
        const pin = req.headers['x-pin'];
        const correctPin = this.configManager.config.dashboardPin || '1234';
        if (pin !== correctPin) {
          logger.warn(`[Security] Percobaan aksi ${req.method} ${req.originalUrl} ditolak (PIN tidak valid) dari ${req.ip || 'unknown'}`);
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
    const mediaRepairLocks = new Set();

    this.app.use('/media', (req, res, next) => {
      const recordDir = this.getRecordsDir();
      
      let decodedPath = '';
      try {
        decodedPath = decodeURIComponent(req.path || '');
      } catch (err) {
        return res.status(400).send('Bad Request: Malformed URI');
      }

      const cleanRelPath = decodedPath.replace(/^[/\\]+/, '');
      let fullPath = path.resolve(recordDir, cleanRelPath);
      
      // Strict path traversal protection
      const rel = path.relative(recordDir, fullPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return res.status(403).send('Forbidden');
      }

      // If exact file does not exist, check if the folder was renamed to a completed session
      if (!fs.existsSync(fullPath)) {
        const parentDir = path.dirname(fullPath);
        const fileName = path.basename(fullPath);
        const parentBaseName = path.basename(parentDir).replace(/_to_\d{2}-\d{2}-\d{2}$/i, '');
        const rootDir = path.dirname(parentDir);

        if (fs.existsSync(rootDir)) {
          try {
            const siblings = fs.readdirSync(rootDir);
            for (const sib of siblings) {
              if (sib.startsWith(parentBaseName)) {
                const candidate = path.join(rootDir, sib, fileName);
                if (fs.existsSync(candidate)) {
                  fullPath = candidate;
                  break;
                }
              }
            }
          } catch (e) {}
        }
      }

      // Auto-repair missing EBML headers for rollover WebM chunks
      if (fs.existsSync(fullPath) && fullPath.endsWith('.webm') && !mediaRepairLocks.has(fullPath)) {
        let fd = null;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size >= 4) {
            fd = fs.openSync(fullPath, 'r');
            const magic = Buffer.alloc(4);
            fs.readSync(fd, magic, 0, 4, 0);
            fs.closeSync(fd);
            fd = null;

            if (magic.toString('hex') !== '1a45dfa3') {
              mediaRepairLocks.add(fullPath);
              const parentDir = path.dirname(fullPath);
              let p1Path = path.join(parentDir, 'Part_001.webm');
              
              if (!fs.existsSync(p1Path)) {
                const baseFolder = path.basename(parentDir).replace(/_to_\d{2}-\d{2}-\d{2}$/i, '');
                const rootDir = path.dirname(parentDir);
                if (fs.existsSync(rootDir)) {
                  const siblings = fs.readdirSync(rootDir);
                  for (const sib of siblings) {
                    if (sib.startsWith(baseFolder)) {
                      const candidate = path.join(rootDir, sib, 'Part_001.webm');
                      if (fs.existsSync(candidate)) {
                        p1Path = candidate;
                        break;
                      }
                    }
                  }
                }
              }

              if (fs.existsSync(p1Path) && path.resolve(p1Path) !== path.resolve(fullPath)) {
                // Read at most 64KB for EBML header search to prevent memory spike on large files
                let p1Fd = null;
                try {
                  p1Fd = fs.openSync(p1Path, 'r');
                  const p1HeaderSample = Buffer.alloc(65536);
                  const bytesRead = fs.readSync(p1Fd, p1HeaderSample, 0, 65536, 0);
                  const p1Buf = p1HeaderSample.slice(0, bytesRead);
                  const clusterMarker = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
                  const clusterIdx = p1Buf.indexOf(clusterMarker);
                  if (clusterIdx > 0 && p1Buf.slice(0, 4).toString('hex') === '1a45dfa3') {
                    const headerBuf = p1Buf.slice(0, clusterIdx);
                    const currentData = fs.readFileSync(fullPath);
                    const repairedData = Buffer.concat([headerBuf, currentData]);
                    const tempPath = `${fullPath}.tmp_${Date.now()}`;
                    fs.writeFileSync(tempPath, repairedData);
                    try {
                      fs.renameSync(tempPath, fullPath);
                    } catch (rnErr) {
                      fs.copyFileSync(tempPath, fullPath);
                      try { fs.unlinkSync(tempPath); } catch (e) {}
                    }
                    logger.info(`[Media] Berhasil memperbaiki WebM header yang hilang untuk: ${path.basename(fullPath)}`);
                  }
                } finally {
                  if (p1Fd !== null) try { fs.closeSync(p1Fd); } catch(e) {}
                }
              }
              mediaRepairLocks.delete(fullPath);
            }
          }
        } catch (repairErr) {
          mediaRepairLocks.delete(fullPath);
          logger.warn(`[Media] Auto-repair check error: ${repairErr.message}`);
        } finally {
          if (fd !== null) try { fs.closeSync(fd); } catch(e) {}
        }
      }

      if (!fs.existsSync(fullPath)) {
        return res.status(404).send('File not found');
      }

      if (fullPath.endsWith('.webm')) {
        res.setHeader('Content-Type', 'audio/webm');
      }
      
      res.sendFile(fullPath, (err) => {
        if (err && !res.headersSent && err.code !== 'ECONNABORTED' && err.status !== 304) {
          res.status(404).send('File not found');
        }
      });
    });
  }

  /**
   * Helper mendapatkan direktori absolut penyimpanan rekaman audio di server.
   */
  getRecordsDir() {
    const os = require('os');
    const path = require('path');
    return path.resolve(
      this.configManager?.config?.recordDir ||
      this.configManager?.config?.recordsDir ||
      path.join(os.homedir(), 'Documents', 'AudioMonitor-Recordings-Server')
    );
  }

  /**
   * Mendaftarkan seluruh rute (endpoints) API HTTP.
   * Digunakan oleh Dashboard untuk mengubah pengaturan atau mengambil data riwayat.
   */
  setupRoutes() {
    
    // Internal API: Menerima file rekaman audio dari Agent
    this.app.post('/internal/upload-record', (req, res) => {
      const getHeaderStr = (val, fallback) => {
        if (Array.isArray(val)) return String(val[0] || fallback);
        return String(val !== undefined && val !== null ? val : fallback);
      };

      const agentName = getHeaderStr(req.headers['x-agent-name'], 'UnknownAgent');
      const rawSessionFolder = getHeaderStr(req.headers['x-session-folder'], 'UnknownSession');
      const rawFileName = getHeaderStr(req.headers['x-file-name'], 'UnknownFile.webm');
      
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      
      // Sanitize path components to prevent path traversal
      const sessionFolder = path.basename(rawSessionFolder).replace(/[^a-zA-Z0-9_\-\.]/g, '');
      const fileName = path.basename(rawFileName).replace(/[^a-zA-Z0-9_\-\.]/g, '');

      if (!sessionFolder || !fileName || sessionFolder === '.' || sessionFolder === '..') {
        return res.status(400).json({ success: false, error: 'Invalid folder or file name' });
      }

      const baseDir = path.resolve(
        this.configManager.config.recordDir || 
        path.join(os.homedir(), 'Documents', 'AudioMonitor-Recordings-Server')
      );
      const targetDir = path.resolve(baseDir, sessionFolder);
      const rel = path.relative(baseDir, targetDir);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      
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
                try {
                  fs.renameSync(oldFilePath, newFilePath);
                } catch (mvErr) {
                  // Fallback copy if rename fails due to active file lock
                  fs.copyFileSync(oldFilePath, newFilePath);
                  try { fs.unlinkSync(oldFilePath); } catch (e) {}
                }
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
          this.invalidateRecordsCache();
          if (this.transcriptionManager) {
            try {
              if (filePath.endsWith('.webm')) {
                this.transcriptionManager.repairWebMFile(filePath);
              }
            } catch (rErr) {
              logger.warn(`[Upload] Auto-repair WebM check: ${rErr.message}`);
            }
            this.transcriptionManager.enqueueFile(filePath, sessionFolder, fileName, agentName);
          }
          sendResponse(200, { success: true, message: 'Upload selesai', path: filePath });
        });
        
        writeStream.on('error', (err) => {
          logger.error(`[Upload] Gagal menulis file rekaman dari ${agentName}: ${err.message}`);
          sendResponse(500, { success: false, error: err.message });
        });
        
        req.on('error', (err) => {
          logger.error(`[Upload] Gagal menerima file rekaman dari ${agentName}: ${err.message}`);
          writeStream.destroy();
          sendResponse(500, { success: false, error: err.message });
        });

        req.on('close', () => {
          if (!req.complete) {
            writeStream.destroy();
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
          }
        });
      } catch (err) {
        logger.error(`[Upload] Error initializing stream: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Mengambil log sistem terstruktur (dari memori real-time atau berkas arsip)
    this.app.get('/api/logs', (req, res) => {
      const { date, level, search, tag, limit, offset } = req.query || {};
      const safeLimit = Math.max(1, Math.min(parseInt(limit) || 200, 1000));
      const safeOffset = Math.max(0, parseInt(offset) || 0);

      if (date && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const fileResult = logger.getLogsForDate(date, {
          level: level || 'ALL',
          search: search || '',
          tag: tag || 'ALL',
          limit: safeLimit,
          offset: safeOffset
        });
        return res.json({
          success: true,
          date,
          total: fileResult.total,
          logs: fileResult.logs,
          raw: logger.getTodayLogs()
        });
      } else {
        const recent = logger.getRecentLogs(safeLimit, {
          level: level || 'ALL',
          search: search || '',
          tag: tag || 'ALL'
        });
        return res.json({
          success: true,
          total: recent.length,
          logs: recent,
          raw: logger.getTodayLogs()
        });
      }
    });

    // API: Mengambil daftar tanggal berkas log yang tersedia
    this.app.get('/api/logs/dates', (req, res) => {
      res.json({ success: true, dates: logger.listLogDates() });
    });

    // API: Mengunduh berkas log harian
    this.app.get('/api/logs/download', (req, res) => {
      const { date } = req.query || {};
      const logFilePath = logger.getLogFilePath(date);

      if (!fs.existsSync(logFilePath)) {
        return res.status(404).send('Berkas log tidak ditemukan');
      }

      const fileName = path.basename(logFilePath);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const fileStream = fs.createReadStream(logFilePath);
      fileStream.pipe(res);
    });

    // API: Membersihkan log memori atau log lawas (Dilindungi PIN)
    this.app.delete('/api/logs/clear', (req, res) => {
      const { mode, retentionDays } = req.body || {};
      if (mode === 'files') {
        const result = logger.cleanOldLogs(parseInt(retentionDays) || 30);
        logger.audit(`[LogManager] Membersihkan ${result.deletedCount} berkas log lawas (${(result.freedBytes / 1024).toFixed(1)} KB dibebaskan)`);
        return res.json({ success: true, ...result });
      } else {
        logger.clearMemoryLogs();
        logger.audit('[LogManager] Buffer log memori dikosongkan oleh administrator');
        return res.json({ success: true, message: 'Buffer log memori berhasil dikosongkan' });
      }
    });
    
    // API: Menghapus sebuah PC (Agent) dari daftar Dashboard
    this.app.delete('/api/pc/:uuid', (req, res) => {
      // Validasi PIN sekali lagi untuk proteksi ganda (meski sudah ada middleware)
      const pin = req.headers['x-pin'];
      const correctPin = this.configManager.config.dashboardPin || '1234';
      if (!pin || pin !== correctPin) {
        logger.warn(`[Security] Percobaan hapus PC ${req.params.uuid} ditolak (PIN tidak valid)`);
        return res.status(401).json({ error: 'Invalid PIN' });
      }
      const { uuid } = req.params;
      const pcName = this.configManager.getPcName(uuid) || uuid;
      this.telemetryHub.deleteAgent(uuid);
      if (this.configManager.config.pcMapping) {
        delete this.configManager.config.pcMapping[uuid];
      }
      this.configManager.saveConfig();
      logger.audit(`[PCManager] Administrator menghapus PC Host ${pcName} (${uuid}) dari sistem`);
      res.json({ success: true });
    });
    
    // API: Mengubah nama alias PC
    this.app.post('/api/rename', (req, res) => {
      const { uuid, newName } = req.body;
      if (!uuid || !newName) return res.status(400).send({ success: false, error: 'Invalid data' });
      
      const oldName = this.configManager.getPcName(uuid) || uuid;
      this.configManager.setPcName(uuid, newName);
        
      // Memberitahu PC tujuan agar mengganti nama lokalnya di layar aplikasinya
      this.telemetryHub.notifyAgentNameChange(uuid, newName);
      
      // Memperbarui memori Server & menyebarkan nama baru ke seluruh layar Dashboard admin lainnya
      const existing = this.telemetryHub.lastKnownState.get(uuid) || {};
      existing.pcName = newName;
      this.telemetryHub.lastKnownState.set(uuid, existing);
      this.telemetryHub.io.to('dashboards').emit('dashboard-update', existing);

      logger.audit(`[PCManager] Administrator mengubah nama PC Host ${uuid} dari "${oldName}" menjadi "${newName}"`);
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
        if (err) {
          logger.error(`[IncidentManager] Gagal menghapus riwayat insiden: ${err.message}`);
          return res.status(500).send({ success: false, error: err.message });
        }
        logger.audit('[IncidentManager] Administrator menghapus seluruh riwayat insiden audio');
        res.send({ success: true });
      });
    });

    // API: Mengambil daftar file rekaman (Termasuk sesi yang audionya telah dibersihkan namun transkrip tetap ada)
    this.app.get('/api/records', (req, res) => {
      // In-Memory Cache Check: Kembalikan cache jika masih valid dalam rentang TTL
      if (this._recordsCache && (Date.now() - this._recordsCacheTime < this._recordsCacheTtlMs)) {
        return res.json(this._recordsCache);
      }

      const fs = require('fs');
      const path = require('path');
      const recordDir = this.getRecordsDir();
      
      const records = [];
      const recordsDir = this.getRecordsDir();
      const activeAlertKeywords = this.configManager ? (this.configManager.getTranscriptionConfig().alertKeywords || []) : [];

      if (fs.existsSync(recordsDir)) {
        try {
          const pcFolders = fs.readdirSync(recordDir);
          for (const pc of pcFolders) {
            try {
              const pcPath = path.join(recordDir, pc);
              const pcStat = fs.statSync(pcPath);
              if (!pcStat.isDirectory()) continue;

              const AUDIO_EXTS = new Set(['.webm', '.ogg', '.wav', '.mp3', '.m4a']);
              const files = fs.readdirSync(pcPath);
              const audioFiles = [];
              const transcriptFiles = [];
              const isAudioPurged = fs.existsSync(path.join(pcPath, '.audio_purged.json'));

              for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                if (AUDIO_EXTS.has(ext)) {
                  audioFiles.push(file);
                } else if (file.endsWith('.transcript.json')) {
                  transcriptFiles.push(file);
                }
              }

              // Regex match folder: PC_Testing_3365df9b-62ec-46ed-8644-83db7d225868_2026-08-29_00-48-53_to_00-49-02
              const match = pc.match(/^(.*)_([a-f0-9\-]{36})_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})(?:_to_(\d{2}-\d{2}-\d{2}))?$/i);
              let realPcName = pc;
              let uuid = '';
              let isParsed = false;
              let isCompleted = /_to_\d{2}-\d{2}-\d{2}$/i.test(pc);
              let baseSessionKey = pc.replace(/_to_\d{2}-\d{2}-\d{2}$/i, '');
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

              // 1. Jika ada file audio fisik
              if (audioFiles.length > 0) {
                for (const file of audioFiles) {
                  try {
                    const filePath = path.join(pcPath, file);
                    const stat = fs.statSync(filePath);
                    if (!stat.isFile()) continue;

                    const transcriptFile = path.join(pcPath, `${file}.transcript.json`);
                    const hasTranscript = fs.existsSync(transcriptFile);
                    let transcriptSnippet = '';
                    let keywordsFound = [];
                    let transcriptDuration = 0;

                    if (hasTranscript) {
                      try {
                        const tData = JSON.parse(fs.readFileSync(transcriptFile, 'utf8'));
                        if (tData.text) {
                          const cleanT = tData.text.trim();
                          transcriptSnippet = cleanT.length > 180 ? cleanT.substring(0, 180) + '...' : cleanT;
                          if (activeAlertKeywords.length > 0 && this.transcriptionManager) {
                            const dynamicKeywords = this.transcriptionManager.scanAlertKeywords(cleanT, activeAlertKeywords);
                            keywordsFound = Array.from(new Set([...(Array.isArray(tData.keywordsFound) ? tData.keywordsFound : []), ...dynamicKeywords]));
                          } else if (Array.isArray(tData.keywordsFound) && tData.keywordsFound.length > 0) {
                            keywordsFound = tData.keywordsFound;
                          }
                        }
                        if (typeof tData.duration === 'number' && tData.duration > 0) {
                          transcriptDuration = tData.duration;
                        }
                      } catch (tErr) {}
                    }

                    records.push({
                      folderName: pc,
                      baseSessionKey,
                      isCompleted,
                      pcName: realPcName,
                      uuid,
                      isParsed,
                      dateStr,
                      timeStr,
                      startTime: match ? match[4] : '',
                      endTime: match && match[5] ? match[5] : '',
                      fileName: file,
                      size: stat.size,
                      hasAudio: true,
                      audioPurged: false,
                      hasTranscript,
                      transcriptSnippet,
                      keywordsFound,
                      transcriptDuration,
                      createdAt: stat.birthtime && stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime,
                      url: `/media/${encodeURIComponent(pc)}/${encodeURIComponent(file)}`
                    });
                  } catch (fileErr) {
                    logger.warn(`Gagal membaca file rekaman ${file}: ${fileErr.message}`);
                  }
                }
              } 
              // 2. Jika audio fisik telah dibersihkan tetapi file transkrip / marker masih ada
              else if (transcriptFiles.length > 0 || isAudioPurged) {
                if (transcriptFiles.length > 0) {
                  for (const tf of transcriptFiles) {
                    try {
                      const transcriptPath = path.join(pcPath, tf);
                      const tStat = fs.statSync(transcriptPath);
                      let transcriptSnippet = '';
                      let keywordsFound = [];
                      let transcriptDuration = 0;

                      try {
                        const tData = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
                        if (tData.text) {
                          const cleanT = tData.text.trim();
                          transcriptSnippet = cleanT.length > 180 ? cleanT.substring(0, 180) + '...' : cleanT;
                          if (activeAlertKeywords.length > 0 && this.transcriptionManager) {
                            const dynamicKeywords = this.transcriptionManager.scanAlertKeywords(cleanT, activeAlertKeywords);
                            keywordsFound = Array.from(new Set([...(Array.isArray(tData.keywordsFound) ? tData.keywordsFound : []), ...dynamicKeywords]));
                          } else if (Array.isArray(tData.keywordsFound) && tData.keywordsFound.length > 0) {
                            keywordsFound = tData.keywordsFound;
                          }
                        }
                        if (typeof tData.duration === 'number' && tData.duration > 0) {
                          transcriptDuration = tData.duration;
                        }
                      } catch (e) {}

                      records.push({
                        folderName: pc,
                        baseSessionKey,
                        isCompleted,
                        pcName: realPcName,
                        uuid,
                        isParsed,
                        dateStr,
                        timeStr,
                        startTime: match ? match[4] : '',
                        endTime: match && match[5] ? match[5] : '',
                        fileName: tf.replace('.transcript.json', ''),
                        size: 0,
                        hasAudio: false,
                        audioPurged: true,
                        hasTranscript: true,
                        transcriptSnippet,
                        keywordsFound,
                        transcriptDuration,
                        createdAt: tStat.birthtime && tStat.birthtime.getTime() > 0 ? tStat.birthtime : tStat.mtime,
                        url: ''
                      });
                    } catch (tErr) {
                      logger.warn(`Gagal membaca transkrip terarsip ${tf}: ${tErr.message}`);
                    }
                  }
                } else {
                  records.push({
                    folderName: pc,
                    baseSessionKey,
                    isCompleted,
                    pcName: realPcName,
                    uuid,
                    isParsed,
                    dateStr,
                    timeStr,
                    startTime: match ? match[4] : '',
                    endTime: match && match[5] ? match[5] : '',
                    fileName: 'audio.purged',
                    size: 0,
                    hasAudio: false,
                    audioPurged: true,
                    hasTranscript: false,
                    transcriptSnippet: '',
                    keywordsFound: [],
                    transcriptDuration: 0,
                    createdAt: pcStat.birthtime && pcStat.birthtime.getTime() > 0 ? pcStat.birthtime : pcStat.mtime,
                    url: ''
                  });
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
      this._recordsCache = records;
      this._recordsCacheTime = Date.now();
      res.json(records);
    });

    // API: Hapus file rekaman tunggal
    this.app.delete('/api/records', (req, res) => {
      const { pcName, fileName } = req.body || {};
      if (typeof pcName !== 'string' || typeof fileName !== 'string' || !pcName.trim() || !fileName.trim()) {
        return res.status(400).send({ success: false, error: 'Bad Request: pcName and fileName are required' });
      }
      
      const fs = require('fs');
      const path = require('path');
      const baseDir = this.getRecordsDir();
      
      // Mencegah path traversal attack
      const safePcName = path.basename(pcName).replace(/[^a-zA-Z0-9_\-\. ]/g, '');
      const safeFileName = path.basename(fileName).replace(/[^a-zA-Z0-9_\-\.]/g, '');

      if (!safePcName || !safeFileName || safePcName === '.' || safePcName === '..') {
        return res.status(400).json({ success: false, error: 'Invalid path parameters' });
      }
      
      const filePath = path.resolve(baseDir, safePcName, safeFileName);
      const rel = path.relative(baseDir, filePath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          // Hapus juga file transkrip jika ada
          const transcriptPath = `${filePath}.transcript.json`;
          if (fs.existsSync(transcriptPath)) {
            try { fs.unlinkSync(transcriptPath); } catch (e) {}
          }
          this.invalidateRecordsCache();
          logger.audit(`[RecordManager] Administrator menghapus file rekaman ${safePcName}/${safeFileName}`);
          res.json({ success: true });
        } catch (e) {
          logger.error(`[RecordManager] Gagal menghapus file ${safePcName}/${safeFileName}: ${e.message}`);
          res.status(500).json({ success: false, error: e.message });
        }
      } else {
        res.status(404).json({ success: false, error: 'File not found' });
      }
    });

    // API: Hapus file audio (.webm) pada server per sesi, namun tetap mempertahankan file transkrip
    this.app.post('/api/records/purge-session-audio', (req, res) => {
      const folderName = req.body?.folderName || req.body?.folder;
      if (!folderName || typeof folderName !== 'string') {
        return res.status(400).json({ success: false, error: 'folderName is required' });
      }

      const fs = require('fs');
      const path = require('path');
      const baseDir = this.getRecordsDir();
      const safeFolder = path.basename(folderName).replace(/[^a-zA-Z0-9_\-\. ]/g, '').trim();

      if (!safeFolder || safeFolder === '.' || safeFolder === '..') {
        return res.status(400).json({ success: false, error: 'Invalid folder path' });
      }

      const folderPath = path.resolve(baseDir, safeFolder);
      const rel = path.relative(baseDir, folderPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
        return res.status(404).json({ success: false, error: 'Folder sesi tidak ditemukan di server' });
      }

      const AUDIO_EXTS = new Set(['.webm', '.ogg', '.wav', '.mp3', '.m4a']);
      let freedBytes = 0;
      let deletedFiles = 0;
      let preservedTranscripts = 0;

      try {
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          const fullFilePath = path.join(folderPath, file);
          try {
            const stat = fs.statSync(fullFilePath);
            if (AUDIO_EXTS.has(ext) && stat.isFile()) {
              freedBytes += stat.size;
              fs.unlinkSync(fullFilePath);
              deletedFiles++;
            } else if (file.endsWith('.transcript.json') || file.endsWith('.txt') || file.endsWith('.srt')) {
              preservedTranscripts++;
            }
          } catch (err) {
            logger.warn(`[PurgeAudio] Gagal menghapus file ${file}: ${err.message}`);
          }
        }

        // Tulis penanda .audio_purged.json dan .audio_purged
        const purgeMarkerPath = path.join(folderPath, '.audio_purged.json');
        fs.writeFileSync(purgeMarkerPath, JSON.stringify({
          purgedAt: new Date().toISOString(),
          freedBytes,
          freedMb: (freedBytes / (1024 * 1024)).toFixed(2),
          deletedFiles,
          preservedTranscripts
        }));
        try {
          fs.writeFileSync(path.join(folderPath, '.audio_purged'), 'purged', 'utf8');
        } catch (mErr) {}

        const freedMb = (freedBytes / (1024 * 1024)).toFixed(2);
        this.invalidateRecordsCache();
        logger.audit(`[PurgeAudio] Administrator membersihkan audio sesi ${safeFolder} (${freedMb} MB dibebaskan, ${deletedFiles} file dihapus, ${preservedTranscripts} transkrip dipertahankan)`);
        res.json({
          success: true,
          freedBytes,
          freedMb,
          deletedFiles,
          preservedTranscripts,
          message: `Berhasil membebaskan ${freedMb} MB ruang disk server. Transkrip teks percakapan tetap tersimpan.`
        });
      } catch (err) {
        logger.error(`[PurgeAudio] Gagal memproses pembersihan audio pada ${safeFolder}: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Hapus seluruh sesi rekaman (audio beserta transkrip)
    this.app.delete('/api/records/session', (req, res) => {
      const { folderName } = req.body || {};
      if (!folderName || typeof folderName !== 'string') {
        return res.status(400).json({ success: false, error: 'folderName is required' });
      }

      const fs = require('fs');
      const path = require('path');
      const baseDir = this.getRecordsDir();
      const safeFolder = path.basename(folderName).replace(/[^a-zA-Z0-9_\-\. ]/g, '').trim();

      if (!safeFolder || safeFolder === '.' || safeFolder === '..') {
        return res.status(400).json({ success: false, error: 'Invalid folder path' });
      }

      const folderPath = path.resolve(baseDir, safeFolder);
      const rel = path.relative(baseDir, folderPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      if (fs.existsSync(folderPath)) {
        try {
          fs.rmSync(folderPath, { recursive: true, force: true });
          this.invalidateRecordsCache();
          logger.audit(`[RecordManager] Administrator menghapus seluruh sesi rekaman ${safeFolder} beserta transkripnya`);
          res.json({ success: true, message: 'Seluruh sesi rekaman dan transkrip berhasil dihapus.' });
        } catch (err) {
          logger.error(`[RecordManager] Gagal menghapus sesi ${safeFolder}: ${err.message}`);
          res.status(500).json({ success: false, error: err.message });
        }
      } else {
        res.status(404).json({ success: false, error: 'Folder sesi tidak ditemukan' });
      }
    });

    // API: Ambil transkrip untuk file atau seluruh sesi rekaman
    this.app.get('/api/records/transcript', (req, res) => {
      const { folder, file } = req.query || {};
      if (!folder || typeof folder !== 'string') return res.status(400).json({ success: false, error: 'Folder parameter is required' });

      const baseDir = this.getRecordsDir();
      const safeFolder = path.basename(folder).replace(/[^a-zA-Z0-9_\-\. ]/g, '').trim();
      if (!safeFolder || safeFolder === '.' || safeFolder === '..' || safeFolder.startsWith('..')) {
        return res.status(400).json({ success: false, error: 'Invalid folder path' });
      }

      const folderPath = path.resolve(baseDir, safeFolder);
      const relFolder = path.relative(baseDir, folderPath);
      if (relFolder.startsWith('..') || path.isAbsolute(relFolder)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      if (file) {
        if (typeof file !== 'string') return res.status(400).json({ success: false, error: 'Invalid file parameter' });
        const safeFile = path.basename(file).replace(/[^a-zA-Z0-9_\-\.]/g, '').trim();
        if (!safeFile || safeFile === '.' || safeFile === '..' || safeFile.startsWith('..')) {
          return res.status(400).json({ success: false, error: 'Invalid file name' });
        }

        const filePath = path.resolve(folderPath, safeFile);
        const relFile = path.relative(baseDir, filePath);
        if (relFile.startsWith('..') || path.isAbsolute(relFile)) {
          return res.status(403).json({ success: false, error: 'Forbidden' });
        }

        const transcript = this.transcriptionManager.getTranscriptForFile(filePath);
        if (!transcript) return res.status(404).json({ success: false, error: 'Transcript not found' });
        return res.json({ success: true, transcript });
      } else {
        const sessionTranscript = this.transcriptionManager.getTranscriptForSession(folderPath);
        if (!sessionTranscript) return res.status(404).json({ success: false, error: 'Transcript not found' });
        return res.json({ success: true, transcript: sessionTranscript });
      }
    });

    // API: Pemicu manual transkripsi file audio atau seluruh sesi
    this.app.post('/api/records/transcribe', async (req, res) => {
      const { folder, file, pcName } = req.body || {};
      if (!folder || typeof folder !== 'string') {
        return res.status(400).json({ success: false, error: 'folder parameter is required' });
      }

      const baseDir = this.getRecordsDir();
      const safeFolder = path.basename(folder).replace(/[^a-zA-Z0-9_\-\. ]/g, '').trim();

      if (!safeFolder || safeFolder === '.' || safeFolder === '..' || safeFolder.startsWith('..')) {
        return res.status(400).json({ success: false, error: 'Invalid path parameters' });
      }

      const folderPath = path.resolve(baseDir, safeFolder);
      const relFolder = path.relative(baseDir, folderPath);
      if (relFolder.startsWith('..') || path.isAbsolute(relFolder)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      if (!fs.existsSync(folderPath)) {
        return res.status(404).json({ success: false, error: 'Session folder not found' });
      }

      logger.info(`[Whisper] Memulai permintaan transkripsi manual untuk folder sesi ${safeFolder} (Target: ${file || 'seluruh sesi'}, PC: ${pcName || 'unknown'})`);

      // Jika file ditentukan secara spesifik
      if (file && typeof file === 'string' && file !== 'all') {
        const safeFile = path.basename(file).replace(/[^a-zA-Z0-9_\-\.]/g, '').trim();
        if (!safeFile || safeFile === '.' || safeFile === '..' || safeFile.startsWith('..')) {
          return res.status(400).json({ success: false, error: 'Invalid file name' });
        }

        const filePath = path.resolve(folderPath, safeFile);
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ success: false, error: 'Audio file not found' });
        }

        try {
          if (this.transcriptionManager) {
            this.transcriptionManager.activeWorkers++;
            this.transcriptionManager.activeTasks.set(filePath, { sessionFolder: safeFolder, fileName: safeFile, pcName });
            this.transcriptionManager.broadcastStatus(safeFolder, safeFile, 'processing');
          }

          const result = await this.transcriptionManager.transcribeFile(filePath, safeFolder, safeFile, pcName);
          if (this.transcriptionManager) {
            this.transcriptionManager.broadcastStatus(safeFolder, safeFile, 'completed');
          }
          this.invalidateRecordsCache();
          return res.json({ success: true, transcript: result });
        } catch (err) {
          if (this.transcriptionManager) {
            this.transcriptionManager.broadcastStatus(safeFolder, safeFile, 'failed', err.message);
          }
          logger.error(`[Whisper] Gagal transkripsi manual ${safeFile}: ${err.message}`);
          return res.status(500).json({ success: false, error: err.message });
        } finally {
          if (this.transcriptionManager) {
            this.transcriptionManager.activeTasks.delete(filePath);
            this.transcriptionManager.activeWorkers = Math.max(0, this.transcriptionManager.activeWorkers - 1);
          }
        }
      } else {
        // Transkripsi SELURUH part audio dalam folder sesi
        try {
          const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.webm') || f.endsWith('.wav') || f.endsWith('.mp3'));
          if (files.length === 0) {
            return res.status(404).json({ success: false, error: 'No audio files found in session folder' });
          }

          // Urutkan file part (Part_001, Part_002, ...)
          files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

          for (const f of files) {
            const fPath = path.join(folderPath, f);
            try {
              if (this.transcriptionManager) {
                this.transcriptionManager.activeWorkers++;
                this.transcriptionManager.activeTasks.set(fPath, { sessionFolder: safeFolder, fileName: f, pcName });
                this.transcriptionManager.broadcastStatus(safeFolder, f, 'processing');
              }

              await this.transcriptionManager.transcribeFile(fPath, safeFolder, f, pcName);
              if (this.transcriptionManager) {
                this.transcriptionManager.broadcastStatus(safeFolder, f, 'completed');
              }
            } catch (pErr) {
              if (this.transcriptionManager) {
                this.transcriptionManager.broadcastStatus(safeFolder, f, 'failed', pErr.message);
              }
              logger.warn(`[Whisper] Gagal transkripsi ${f}: ${pErr.message}`);
            } finally {
              if (this.transcriptionManager) {
                this.transcriptionManager.activeTasks.delete(fPath);
                this.transcriptionManager.activeWorkers = Math.max(0, this.transcriptionManager.activeWorkers - 1);
              }
            }
          }

          this.invalidateRecordsCache();
          const combinedTranscript = this.transcriptionManager.getTranscriptForSession(folderPath);
          return res.json({ success: true, transcript: combinedTranscript });
        } catch (err) {
          logger.error(`[Whisper] Gagal transkripsi manual sesi ${safeFolder}: ${err.message}`);
          return res.status(500).json({ success: false, error: err.message });
        }
      }
    });

    // API: Cari kata kunci di transkrip rekaman dengan filter tanggal dan PC
    this.app.get('/api/records/search-transcript', (req, res) => {
      const { q, startDate, endDate, pcFilter } = req.query || {};
      if (!q || typeof q !== 'string') return res.json({ success: true, results: [] });

      const cleanQuery = q.trim().substring(0, 200);
      if (!cleanQuery) return res.json({ success: true, results: [] });

      const baseDir = this.getRecordsDir();
      const results = this.transcriptionManager.searchTranscripts(cleanQuery, baseDir, {
        startDate: typeof startDate === 'string' ? startDate : '',
        endDate: typeof endDate === 'string' ? endDate : '',
        pcFilter: typeof pcFilter === 'string' ? pcFilter : ''
      });
      res.json({ success: true, results });
    });

    // API: Mengambil status antrean transkripsi Whisper secara real-time
    this.app.get('/api/transcription/queue', (req, res) => {
      const status = this.transcriptionManager ? this.transcriptionManager.getQueueStatus() : { isProcessing: false, currentTask: null, queue: [], queueLength: 0 };
      res.json({ success: true, status, ...status });
    });

    // API: Mengambil konfigurasi Speech-to-Text Whisper
    this.app.get('/api/config/transcription', (req, res) => {
      res.json({ success: true, transcription: this.configManager.getTranscriptionConfig() });
    });

    // API: Menyimpan konfigurasi Speech-to-Text Whisper
    this.app.post('/api/config/transcription', (req, res) => {
      const { enabled, apiUrl, apiKey, language, autoTranscribe, alertKeywords } = req.body || {};
      
      const updateData = {};
      if (enabled !== undefined) updateData.enabled = !!enabled;
      if (apiUrl !== undefined) {
        const cleanUrl = String(apiUrl).trim();
        updateData.apiUrl = cleanUrl;
      }
      if (apiKey !== undefined) updateData.apiKey = String(apiKey).trim();
      if (language !== undefined) updateData.language = String(language).trim();
      if (autoTranscribe !== undefined) updateData.autoTranscribe = !!autoTranscribe;
      if (alertKeywords !== undefined) {
        if (Array.isArray(alertKeywords)) {
          updateData.alertKeywords = Array.from(new Set(alertKeywords.map(k => String(k).trim().toLowerCase()).filter(Boolean)));
        } else if (typeof alertKeywords === 'string') {
          updateData.alertKeywords = Array.from(new Set(alertKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)));
        }
      }

      this.configManager.setTranscriptionConfig(updateData);
      logger.audit(`[Whisper] Konfigurasi Speech-to-Text diperbarui: status=${updateData.enabled !== false ? 'aktif' : 'nonaktif'}, bahasa=${updateData.language || 'id'}, autoTranscribe=${updateData.autoTranscribe !== false}`);
      
      // Jika kata bahaya diperbarui, sinkronisasikan ke seluruh berkas transkrip historis di background
      if (updateData.alertKeywords !== undefined) {
        setTimeout(() => {
          try {
            const rescanRes = this.transcriptionManager.rescanAllTranscripts(this.getRecordsDir());
            if (rescanRes && rescanRes.updatedFiles > 0) {
              this.invalidateRecordsCache();
            }
          } catch (rErr) {
            logger.warn(`[Whisper] Background rescan kata bahaya: ${rErr.message}`);
          }
        }, 50);
      }

      res.json({ success: true, transcription: this.configManager.getTranscriptionConfig() });
    });

    // API: Pemicu pemindaian ulang kata bahaya pada seluruh rekaman transkrip historis
    this.app.post('/api/transcription/rescan-keywords', (req, res) => {
      try {
        const recordsDir = this.getRecordsDir();
        logger.info('[Whisper] Memicu pemindaian ulang kata bahaya pada seluruh riwayat rekaman');
        const result = this.transcriptionManager.rescanAllTranscripts(recordsDir);
        if (result && result.updatedFiles > 0) {
          this.invalidateRecordsCache();
        }
        res.json({ success: true, ...result });
      } catch (err) {
        logger.error(`[Whisper] Error rescan keywords: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Menguji konektivitas ke Whisper API
    this.app.post('/api/transcription/test-api', async (req, res) => {
      const { apiUrl, apiKey } = req.body || {};
      const targetUrl = (apiUrl !== undefined && apiUrl !== null) ? String(apiUrl).trim() : this.configManager.getTranscriptionConfig().apiUrl;
      const targetKey = apiKey !== undefined ? String(apiKey).trim() : this.configManager.getTranscriptionConfig().apiKey;

      logger.info(`[Whisper] Menguji konektivitas endpoint Speech-to-Text API: ${targetUrl}`);
      const result = await this.transcriptionManager.testConnection(targetUrl, targetKey);
      res.json(result);
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
          logger.error(`[Telegram] Gagal inisialisasi bot: ${err.message}`);
        }
      
      // Sebarkan kunci Telegram yang baru ke semua PC Agent sebagai cadangan darurat (Fallback Offline)
      this.telemetryHub.io.to('agents').emit('telegram-config', this.configManager.getTelegramConfig());
      logger.audit(`[Telegram] Konfigurasi Telegram diperbarui (Interval notifikasi: ${this.configManager.config.telegram.interval}s, Retensi: ${this.configManager.config.logRetentionDays} hari)`);
      
      res.send({ success: true, telegram: this.configManager.config.telegram });
    });

    // API: Mematikan/Menyalakan seluruh aktivitas pemantauan secara global
    this.app.post('/api/config/monitoring', (req, res) => {
      const { active } = req.body;
      this.configManager.config.monitoringActive = active;
      this.configManager.saveConfig();
      this.telemetryHub.io.emit('monitoring-status', active); // Umumkan ke seluruh klien
      logger.audit(`[Monitoring] Status pemantauan global diubah menjadi: ${active ? 'AKTIF' : 'NONAKTIF'}`);
      res.send({ success: true, monitoringActive: active });
    });

    // API: Mengubah PIN akses Dashboard
    this.app.post('/api/config/pin', (req, res) => {
      const { newPin } = req.body || {};
      const cleanPin = String(newPin !== undefined && newPin !== null ? newPin : '').trim();
      if (!cleanPin || cleanPin.length < 4) return res.status(400).json({ error: 'PIN minimal 4 karakter' });
      this.configManager.config.dashboardPin = cleanPin;
      this.configManager.saveConfig();
      if (this.telemetryHub) {
        this.telemetryHub.broadcastPinUpdate(cleanPin);
      }
      logger.audit('[Security] PIN Dashboard administrator berhasil diperbarui');
      res.send({ success: true });
    });

    // API: Mengubah batas retensi log lama (Auto-cleanup hari)
    this.app.post('/api/config/retention', (req, res) => {
      const { days } = req.body || {};
      const retentionDays = Math.max(1, parseInt(days, 10) || 30);
      this.configManager.config.logRetentionDays = retentionDays;
      this.configManager.saveConfig();
      const removed = this.dbManager.autoCleanup(retentionDays);
      logger.audit(`[Database] Batas retensi log insiden diubah menjadi ${retentionDays} hari (${removed} entri lawas dihapus)`);
      res.json({ success: true, logRetentionDays: retentionDays, removedCount: removed });
    });

    // API: Memicu pembersihan log lama secara manual seketika
    this.app.post('/api/incidents/cleanup-now', (req, res) => {
      const retentionDays = this.configManager.config.logRetentionDays || 30;
      const removed = this.dbManager.autoCleanup(retentionDays);
      logger.audit(`[Database] Pembersihan log insiden manual dijalankan (${removed} entri lawas dihapus)`);
      res.json({ success: true, removedCount: removed, logRetentionDays: retentionDays });
    });

    // API: Mematikan/Menyalakan pemantauan untuk satu PC secara spesifik
    this.app.post('/api/pc/:uuid/monitoring', (req, res) => {
      const { uuid } = req.params;
      const { active } = req.body || {};
      
      // Mengubah status di memori pusat dan meneruskannya ke Agent dan Dashboard
      this.telemetryHub.setPcMonitoring(uuid, active);
      const pcName = this.configManager.getPcName(uuid) || uuid;
      logger.audit(`[Monitoring] Status pemantauan PC Host ${pcName} (${uuid}) diubah menjadi: ${active ? 'AKTIF' : 'NONAKTIF'}`);
      
      res.send({ success: true, active: !!active });
    });

    // API: Mengubah pengaturan remote config PC tertentu
    this.app.post('/api/pc/:uuid/config', (req, res) => {
      const { uuid } = req.params;
      const config = req.body;
      if (!uuid || !config) return res.status(400).json({ error: 'Bad request' });

      if (config.agentName) {
        this.configManager.setPcName(uuid, config.agentName);
        const existing = this.telemetryHub.lastKnownState.get(uuid) || {};
        existing.pcName = config.agentName;
        this.telemetryHub.lastKnownState.set(uuid, existing);
        this.telemetryHub.io.to('dashboards').emit('dashboard-update', existing);
      }

      this.telemetryHub.io.to('agent-' + uuid).emit('update-config', config);
      const agentSocketId = this.telemetryHub.agentSockets.get(uuid);
      if (agentSocketId) {
        this.telemetryHub.io.to(agentSocketId).emit('update-config', config);
      }

      const pcName = this.configManager.getPcName(uuid) || uuid;
      logger.audit(`[RemoteConfig] Konfigurasi audio remote dikirim ke PC Host ${pcName} (${uuid})`);
      res.json({ success: true, config });
    });

    // API: Mengirim pesan percobaan Telegram ("Ping!")
    this.app.post('/api/telegram/test', (req, res) => {
      logger.info('[Telegram] Mengirim pesan uji coba (Ping!) ke Telegram bot');
      this.alertManager.sendTelegramAlert('[TEST] <b>Ping!</b> Ini adalah pesan percobaan dari AudioMonitor Server.');
      res.json({ success: true, message: 'Test message sent' });
    });

    // Helper direktori penyimpanan pembaruan Agent di server
    const getUpdatesDir = () => {
      const dir = this.configManager?.config?.updatesDir || path.join(os.homedir(), 'Documents', 'AudioMonitor-Updates', 'agent');
      if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      }
      return dir;
    };

    // API: Mendapatkan info pembaruan Agent terbaru yang tersedia di Server
    this.app.get('/updates/agent/info', (req, res) => {
      const updatesDir = getUpdatesDir();
      try {
        if (!fs.existsSync(updatesDir)) {
          return res.json({ hasUpdate: false });
        }
        
        const files = fs.readdirSync(updatesDir).filter(f => f.toLowerCase().endsWith('.exe'));
        if (files.length === 0) {
          return res.json({ hasUpdate: false });
        }

        const semverCompare = (v1, v2) => {
          const p1 = (v1 || '0.0.0').split('.').map(Number);
          const p2 = (v2 || '0.0.0').split('.').map(Number);
          for (let i = 0; i < 3; i++) {
            if ((p1[i] || 0) > (p2[i] || 0)) return 1;
            if ((p1[i] || 0) < (p2[i] || 0)) return -1;
          }
          return 0;
        };

        // Urutkan dari file installer versi tertinggi, lalu mtime
        const installers = files.map(file => {
          const filePath = path.join(updatesDir, file);
          const stat = fs.statSync(filePath);
          const vMatch = file.match(/v?(\d+\.\d+\.\d+)/i);
          return {
            fileName: file,
            version: vMatch ? vMatch[1] : '1.0.0',
            size: stat.size,
            mtime: stat.mtime,
            downloadUrl: `/updates/agent/${encodeURIComponent(file)}`
          };
        }).sort((a, b) => {
          const cmp = semverCompare(b.version, a.version);
          return cmp !== 0 ? cmp : new Date(b.mtime) - new Date(a.mtime);
        });

        const latest = installers[0];
        res.json({
          hasUpdate: true,
          ...latest
        });
      } catch (err) {
        logger.error(`Error reading updates info: ${err.message}`);
        res.status(500).json({ hasUpdate: false, error: err.message });
      }
    });

    // Endpoint streaming download installer Agent untuk PC client di LAN
    this.app.get('/updates/agent/:filename', (req, res) => {
      const updatesDir = getUpdatesDir();
      const safeFileName = path.basename(req.params.filename || '');
      const filePath = path.resolve(updatesDir, safeFileName);
      
      const rel = path.relative(updatesDir, filePath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return res.status(403).send('Forbidden');
      }

      if (fs.existsSync(filePath)) {
        res.sendFile(filePath, (err) => {
          if (err && !res.headersSent && err.code !== 'ECONNABORTED' && err.status !== 304) {
            res.status(404).send('Update file not found');
          }
        });
      } else {
        res.status(404).send('Update file not found');
      }
    });

    // API: Memicu update remote pada Agent (satu PC atau semua PC)
    this.app.post('/api/updates/trigger-agent', (req, res) => {
      const { targetUuid, downloadUrl } = req.body || {};
      if (!downloadUrl) return res.status(400).json({ success: false, error: 'URL unduhan diperlukan' });

      // Temukan alamat IPv4 LAN server
      const getLanIp = () => {
        const ifaces = os.networkInterfaces();
        for (const name of Object.keys(ifaces)) {
          for (const net of ifaces[name]) {
            if (net.family === 'IPv4' && !net.internal) {
              return net.address;
            }
          }
        }
        return 'localhost';
      };

      // Jika URL relatif atau menggunakan localhost/127.0.0.1, ubah ke IP LAN server agar PC lain bisa mengunduh
      let fullDownloadUrl = downloadUrl;
      if (fullDownloadUrl.startsWith('/')) {
        let host = req.headers.host || `localhost:${this.port}`;
        if (host.includes('localhost') || host.includes('127.0.0.1')) {
          const lanIp = getLanIp();
          const port = host.split(':')[1] || this.port;
          host = `${lanIp}:${port}`;
        }
        const protocol = req.protocol || 'http';
        fullDownloadUrl = `${protocol}://${host}${fullDownloadUrl}`;
      } else {
        try {
          const parsed = new URL(fullDownloadUrl);
          if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
            const lanIp = getLanIp();
            parsed.hostname = lanIp;
            fullDownloadUrl = parsed.toString();
          }
        } catch (e) {}
      }

      this.telemetryHub.triggerAgentUpdate(targetUuid || 'all', fullDownloadUrl);
      logger.info(`[UpdateHub] Memicu pembaruan Agent ke target: ${targetUuid || 'all'} (URL: ${fullDownloadUrl})`);
      res.json({ success: true, message: 'Perintah pembaruan disiarkan ke Agent', downloadUrl: fullDownloadUrl });
    });

    // API: Memicu pembersihan file audio lokal pada PC Host lewat Agent
    this.app.post('/api/agents/clean-storage', (req, res) => {
      const { targetUuid, deleteMode, days, onlyUploaded } = req.body || {};
      this.telemetryHub.triggerAgentStorageClean(targetUuid || 'all', {
        deleteMode: deleteMode || 'all',
        days: typeof days === 'number' ? days : 0,
        onlyUploaded: onlyUploaded !== false
      });
      logger.info(`[StorageHub] Memicu pembersihan file audio lokal ke target: ${targetUuid || 'all'} (Mode: ${deleteMode || 'all'}, Hanya Terupload: ${onlyUploaded !== false})`);
      res.json({ success: true, message: 'Perintah pembersihan storage audio lokal telah dikirim ke PC Host' });
    });

    // API: Status Smart Storage & Cloud Sync Automation
    this.app.get('/api/storage/automation-status', (req, res) => {
      try {
        const recordsDir = this.getRecordsDir();
        const status = this.storageAutomationManager.getStorageStatus(recordsDir);
        res.json(status);
      } catch (err) {
        logger.error(`[SmartStorage] Error get storage status: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Konfigurasi Smart Storage & Cloud Sync Automation
    this.app.post('/api/storage/automation-config', (req, res) => {
      try {
        const storageConfig = req.body || {};
        this.configManager.setStorageAutomationConfig(storageConfig);
        logger.audit('[SmartStorage] Konfigurasi otomasi penyimpanan diperbarui oleh administrator');
        res.json({ success: true, config: this.configManager.getStorageAutomationConfig() });
      } catch (err) {
        logger.error(`[SmartStorage] Error set storage config: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Memicu Sinkronisasi Manual ke Backup / NAS / Cloud Webhook
    this.app.post('/api/storage/trigger-sync', async (req, res) => {
      try {
        const recordsDir = this.getRecordsDir();
        logger.info('[SmartStorage] Memicu sinkronisasi manual ke folder cadangan / NAS / Webhook');
        const result = await this.storageAutomationManager.runBackupSync(recordsDir);
        res.json(result);
      } catch (err) {
        logger.error(`[SmartStorage] Error trigger sync: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Memicu pembersihan otomatis audio lawas server berbasis hari (transkrip tetap dipertahankan)
    this.app.post('/api/storage/auto-purge-audio', async (req, res) => {
      try {
        const { days } = req.body || {};
        const recordsDir = this.getRecordsDir();
        logger.info(`[AutoPurgeAudio] Memicu pembersihan audio lawas server (hari: ${days !== undefined ? days : 'sesuai konfigurasi'})`);
        const result = await this.storageAutomationManager.runAutoPurgeRawAudio(recordsDir, days);
        if (result.purgedSessions > 0) {
          this.invalidateRecordsCache();
        }
        res.json(result);
      } catch (err) {
        logger.error(`[AutoPurgeAudio] Error auto purge audio: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Memicu Pengarsipan Manual Berkas Lawas
    this.app.post('/api/storage/trigger-archive', async (req, res) => {
      try {
        const recordsDir = this.getRecordsDir();
        logger.info('[SmartStorage] Memicu kompresi/pengarsipan manual berkas rekaman lawas');
        const result = await this.storageAutomationManager.runAutoArchive(recordsDir);
        res.json(result);
      } catch (err) {
        logger.error(`[SmartStorage] Error trigger archive: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Konfigurasi Audio Engineering Diagnostics
    this.app.get('/api/config/audio-diagnostics', (req, res) => {
      try {
        res.json({ success: true, config: this.configManager.getAudioDiagnosticsConfig() });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.post('/api/config/audio-diagnostics', (req, res) => {
      try {
        const diagConfig = req.body || {};
        this.configManager.setAudioDiagnosticsConfig(diagConfig);
        logger.audit('[AudioDiagnostics] Konfigurasi diagnostik audio diperbarui oleh administrator');
        res.json({ success: true, config: this.configManager.getAudioDiagnosticsConfig() });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Cek Rilis Terbaru di GitHub Releases
    this.app.get('/api/updates/check-github', async (req, res) => {
      const https = require('https');
      const options = {
        hostname: 'api.github.com',
        path: '/repos/maulido/audiomonitor/releases/latest',
        method: 'GET',
        headers: {
          'User-Agent': 'AudioMonitor-Server',
          'Accept': 'application/vnd.github.v3+json'
        }
      };

      const request = https.request(options, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try {
            if (response.statusCode === 200) {
              const release = JSON.parse(body);
              const tag = release.tag_name || '';
              const version = tag.replace(/^v/i, '');
              const agentAsset = (release.assets || []).find(a => 
                a.name.toLowerCase().includes('agent') && a.name.toLowerCase().endsWith('.exe')
              );
              const serverAsset = (release.assets || []).find(a => 
                a.name.toLowerCase().includes('server') && a.name.toLowerCase().endsWith('.exe')
              );

              res.json({
                success: true,
                hasRelease: true,
                tag: release.tag_name,
                version,
                name: release.name,
                publishedAt: release.published_at,
                body: release.body,
                asset: agentAsset ? {
                  name: agentAsset.name,
                  size: agentAsset.size,
                  downloadUrl: agentAsset.browser_download_url
                } : null,
                serverAsset: serverAsset ? {
                  name: serverAsset.name,
                  size: serverAsset.size,
                  downloadUrl: serverAsset.browser_download_url
                } : null
              });
            } else if (response.statusCode === 404) {
              res.json({ success: true, hasRelease: false, message: 'Belum ada rilis di GitHub' });
            } else {
              res.status(response.statusCode).json({ success: false, error: `GitHub API error (${response.statusCode})` });
            }
          } catch (e) {
            res.status(500).json({ success: false, error: e.message });
          }
        });
      });

      request.setTimeout(10000, () => {
        request.destroy(new Error('GitHub API request timed out'));
      });

      request.on('error', (err) => {
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      });
      request.end();
    });

    // API: Mengunduh Installer dari GitHub langsung ke Server
    this.app.post('/api/updates/download-github', async (req, res) => {
      const { downloadUrl, fileName } = req.body || {};
      if (!downloadUrl) return res.status(400).json({ success: false, error: 'Download URL diperlukan' });

      const https = require('https');
      const http = require('http');
      const updatesDir = getUpdatesDir();
      const safeName = path.basename(fileName || 'AudioMonitor_Agent_Installer.exe').replace(/[^a-zA-Z0-9_\-\.]/g, '');
      const destPath = path.join(updatesDir, safeName);
      const tempDest = `${destPath}.tmp_${Date.now()}`;

      const downloadFile = (url, depth = 0) => {
        if (depth > 5) return Promise.reject(new Error('Terlalu banyak redirect'));
        return new Promise((resolve, reject) => {
          let parsed;
          try {
            parsed = new URL(url);
          } catch (err) {
            return reject(new Error(`Invalid URL: ${url}`));
          }
          const client = parsed.protocol === 'https:' ? https : http;
          const req = client.get(url, { headers: { 'User-Agent': 'AudioMonitor-Server' } }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              response.resume();
              const redirectUrl = new URL(response.headers.location, url).href;
              return resolve(downloadFile(redirectUrl, depth + 1));
            }
            if (response.statusCode !== 200) {
              response.resume();
              return reject(new Error(`Gagal mengunduh file: HTTP ${response.statusCode}`));
            }

            let activityTimeout = setTimeout(() => {
              req.destroy(new Error('Timeout koneksi unduh update (120s)'));
            }, 120000);

            const fileStream = fs.createWriteStream(tempDest);
            response.on('data', (chunk) => {
              clearTimeout(activityTimeout);
              activityTimeout = setTimeout(() => {
                req.destroy(new Error('Timeout tidak ada data diterima (60s)'));
              }, 60000);
            });
            response.pipe(fileStream);
            fileStream.on('finish', () => {
              clearTimeout(activityTimeout);
              fileStream.close(() => {
                try {
                  if (fs.existsSync(destPath)) {
                    try { fs.unlinkSync(destPath); } catch (e) {}
                  }
                  try {
                    fs.renameSync(tempDest, destPath);
                  } catch (rnErr) {
                    fs.copyFileSync(tempDest, destPath);
                    try { fs.unlinkSync(tempDest); } catch (e) {}
                  }
                  resolve();
                } catch (err) {
                  reject(err);
                }
              });
            });
            fileStream.on('error', (err) => {
              clearTimeout(activityTimeout);
              try { fs.unlinkSync(tempDest); } catch (e) {}
              reject(err);
            });
            response.on('error', (err) => {
              clearTimeout(activityTimeout);
              fileStream.destroy();
              try { fs.unlinkSync(tempDest); } catch (e) {}
              reject(err);
            });
          });

          req.on('error', reject);
        });
      };

      try {
        logger.info(`[UpdateHub] Memulai pengunduhan installer dari GitHub: ${downloadUrl}`);
        await downloadFile(downloadUrl);
        logger.info(`[UpdateHub] Sukses mengunduh installer ke: ${destPath}`);
        res.json({ success: true, fileName: safeName, path: destPath });
      } catch (err) {
        logger.error(`[UpdateHub] Gagal mengunduh installer dari GitHub: ${err.message}`);
        try { if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest); } catch(e) {}
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Upload installer Agent baru langsung dari Web Dashboard ke Server
    this.app.post('/api/updates/upload-agent', (req, res) => {
      const rawFileName = req.headers['x-file-name'] || 'AudioMonitor_Agent_Installer.exe';
      let safeFileName = '';
      try {
        safeFileName = path.basename(decodeURIComponent(rawFileName)).replace(/[^a-zA-Z0-9_\-\.]/g, '');
      } catch(e) {
        safeFileName = path.basename(rawFileName).replace(/[^a-zA-Z0-9_\-\.]/g, '');
      }

      if (!safeFileName.toLowerCase().endsWith('.exe')) {
        return res.status(400).json({ success: false, error: 'Hanya file installer (.exe) yang diperbolehkan' });
      }

      const updatesDir = getUpdatesDir();
      const filePath = path.join(updatesDir, safeFileName);
      const tempPath = `${filePath}.tmp_${Date.now()}`;

      const writeStream = fs.createWriteStream(tempPath);
      let isFinished = false;

      req.on('close', () => {
        if (!req.complete && !isFinished) {
          writeStream.destroy();
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
        }
      });

      req.on('error', (err) => {
        writeStream.destroy();
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      });

      req.pipe(writeStream);

      writeStream.on('finish', () => {
        isFinished = true;
        try {
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
          }
          try {
            fs.renameSync(tempPath, filePath);
          } catch (rnErr) {
            fs.copyFileSync(tempPath, filePath);
            try { fs.unlinkSync(tempPath); } catch (e) {}
          }
          logger.info(`[UpdateHub] Berhasil menerima upload installer Agent: ${safeFileName}`);
          res.json({ success: true, fileName: safeFileName, path: filePath });
        } catch (e) {
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (uErr) {}
          if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
        }
      });

      writeStream.on('error', (err) => {
        try { fs.unlinkSync(tempPath); } catch(e) {}
        logger.error(`[UpdateHub] Gagal menyimpan file upload update: ${err.message}`);
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      });
    });

    // API: Upload installer Agent baru ke Server (Legacy endpoint)
    this.app.post('/internal/upload-update', (req, res) => {
      const rawFileName = req.headers['x-file-name'] || 'AudioMonitor_Agent_Installer.exe';
      const safeFileName = path.basename(rawFileName).replace(/[^a-zA-Z0-9_\-\.]/g, '');
      const updatesDir = getUpdatesDir();
      const filePath = path.join(updatesDir, safeFileName);

      const writeStream = fs.createWriteStream(filePath);
      req.pipe(writeStream);

      writeStream.on('finish', () => {
        logger.info(`[UpdateHub] Berhasil menerima installer Agent baru: ${safeFileName}`);
        res.json({ success: true, fileName: safeFileName, path: filePath });
      });

      writeStream.on('error', (err) => {
        logger.error(`[UpdateHub] Gagal menyimpan file update: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
      });
    });

    // API: Eksekusi 1-Klik Pembaruan Mandiri Server (Server Self-Update)
    this.app.post('/api/updates/server-self-update', async (req, res) => {
      const { downloadUrl, fileName } = req.body || {};
      if (!downloadUrl) return res.status(400).json({ success: false, error: 'Download URL diperlukan' });

      const https = require('https');
      const http = require('http');
      const os = require('os');
      const { spawn } = require('child_process');
      const tempDir = os.tmpdir();
      const safeName = 'AudioMonitor_Server_Update.exe';
      const destPath = path.join(tempDir, safeName);
      const tempDest = `${destPath}.tmp_${Date.now()}`;

      const downloadFile = (url, depth = 0) => {
        if (depth > 5) return Promise.reject(new Error('Terlalu banyak redirect'));
        return new Promise((resolve, reject) => {
          let parsed;
          try { parsed = new URL(url); } catch (e) { return reject(new Error(`Invalid URL: ${url}`)); }
          const client = parsed.protocol === 'https:' ? https : http;
          const request = client.get(url, { headers: { 'User-Agent': 'AudioMonitor-Server' } }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              response.resume();
              const redirectUrl = new URL(response.headers.location, url).href;
              return resolve(downloadFile(redirectUrl, depth + 1));
            }
            if (response.statusCode !== 200) {
              response.resume();
              return reject(new Error(`HTTP ${response.statusCode}`));
            }
            let activityTimeout = setTimeout(() => {
              request.destroy(new Error('Timeout koneksi unduh update (120s)'));
            }, 120000);

            const fileStream = fs.createWriteStream(tempDest);
            response.on('data', (chunk) => {
              clearTimeout(activityTimeout);
              activityTimeout = setTimeout(() => {
                request.destroy(new Error('Timeout tidak ada data diterima (60s)'));
              }, 60000);
            });
            response.pipe(fileStream);
            fileStream.on('finish', () => {
              clearTimeout(activityTimeout);
              fileStream.close(() => {
                try {
                  if (fs.existsSync(destPath)) {
                    try { fs.unlinkSync(destPath); } catch (e) {}
                  }
                  try {
                    fs.renameSync(tempDest, destPath);
                  } catch (rnErr) {
                    fs.copyFileSync(tempDest, destPath);
                    try { fs.unlinkSync(tempDest); } catch (e) {}
                  }
                  resolve();
                } catch (err) {
                  reject(err);
                }
              });
            });
            fileStream.on('error', (err) => {
              clearTimeout(activityTimeout);
              try { fs.unlinkSync(tempDest); } catch (e) {}
              reject(err);
            });
          });
          request.on('error', reject);
        });
      };

      try {
        logger.info(`[ServerUpdate] Mengunduh pembaruan server dari: ${downloadUrl}`);
        await downloadFile(downloadUrl);
        
        // Verifikasi integritas ukuran file installer sebelum dieksekusi
        const stats = fs.statSync(destPath);
        if (stats.size < 1024 * 1024) {
          throw new Error(`File installer server terlalu kecil atau korup (${stats.size} bytes)`);
        }

        logger.info(`[ServerUpdate] Unduhan server selesai (${(stats.size / 1024 / 1024).toFixed(1)} MB). Menjalankan installer dan me-restart server...`);
        res.json({ success: true, message: 'Installer server berhasil diunduh. Server sedang memperbarui diri...' });

        setTimeout(() => {
          try {
            const child = spawn(destPath, ['/S'], {
              detached: true,
              stdio: 'ignore'
            });
            child.unref();
            process.exit(0);
          } catch (spawnErr) {
            logger.error(`[ServerUpdate] Gagal mengeksekusi installer: ${spawnErr.message}`);
          }
        }, 1000);
      } catch (err) {
        logger.error(`[ServerUpdate] Gagal mengunduh installer server: ${err.message}`);
        try { if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest); } catch (e) {}
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      }
    });

    // API: Upload installer Server baru langsung dari browser dan jalankan self-update
    this.app.post('/api/updates/upload-server', (req, res) => {
      const os = require('os');
      const { spawn } = require('child_process');
      const destPath = path.join(os.tmpdir(), 'AudioMonitor_Server_Update.exe');
      const tempDest = `${destPath}.tmp_${Date.now()}`;
      const fileStream = fs.createWriteStream(tempDest);

      req.pipe(fileStream);

      fileStream.on('finish', () => {
        try {
          if (fs.existsSync(destPath)) {
            try { fs.unlinkSync(destPath); } catch (e) {}
          }
          try {
            fs.renameSync(tempDest, destPath);
          } catch (rnErr) {
            fs.copyFileSync(tempDest, destPath);
            try { fs.unlinkSync(tempDest); } catch (e) {}
          }

          // Verifikasi integritas ukuran file installer sebelum dieksekusi
          const stats = fs.statSync(destPath);
          if (stats.size < 1024 * 1024) {
            throw new Error(`File installer server yang diunggah terlalu kecil (${stats.size} bytes)`);
          }

          logger.info(`[ServerUpdate] Installer server berhasil diunggah (${(stats.size / 1024 / 1024).toFixed(1)} MB). Menjalankan silent install...`);
          res.json({ success: true, message: 'File installer server diterima. Server sedang memperbarui diri...' });

          setTimeout(() => {
            try {
              const child = spawn(destPath, ['/S'], {
                detached: true,
                stdio: 'ignore'
              });
              child.unref();
              process.exit(0);
            } catch (spawnErr) {
              logger.error(`[ServerUpdate] Gagal mengeksekusi installer: ${spawnErr.message}`);
            }
          }, 1000);
        } catch (err) {
          logger.error(`[ServerUpdate] Gagal memproses file upload server: ${err.message}`);
          try { if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest); } catch (e) {}
          if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
        }
      });

      fileStream.on('error', (err) => {
        try { fs.unlinkSync(tempDest); } catch (e) {}
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      });
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
