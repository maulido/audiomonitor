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
    const mediaRepairLocks = new Set();

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

      let fullPath = path.resolve(recordDir, '.' + decodedPath);
      
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
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size >= 4) {
            const fd = fs.openSync(fullPath, 'r');
            const magic = Buffer.alloc(4);
            fs.readSync(fd, magic, 0, 4, 0);
            fs.closeSync(fd);

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
                const p1Buf = fs.readFileSync(p1Path);
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
              }
              mediaRepairLocks.delete(fullPath);
            }
          }
        } catch (repairErr) {
          mediaRepairLocks.delete(fullPath);
          logger.warn(`[Media] Auto-repair check error: ${repairErr.message}`);
        }
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

              const AUDIO_EXTS = new Set(['.webm', '.ogg', '.wav', '.mp3', '.m4a']);
              const files = fs.readdirSync(pcPath);
              for (const file of files) {
                try {
                  const ext = path.extname(file).toLowerCase();
                  if (!AUDIO_EXTS.has(ext)) continue;

                  const filePath = path.join(pcPath, file);
                  const stat = fs.statSync(filePath);
                  if (!stat.isFile()) continue;

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
      const baseDir = path.resolve(this.configManager.config.recordDir || path.join(os.homedir(), 'Documents', 'AudioMonitor-Recordings-Server'));
      
      // Mencegah path traversal attack
      const safePcName = path.basename(pcName).replace(/[^a-zA-Z0-9_\-\.]/g, '');
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

    // Helper direktori penyimpanan pembaruan Agent di server
    const getUpdatesDir = () => {
      const dir = path.join(os.homedir(), 'Documents', 'AudioMonitor-Updates', 'agent');
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

        // Urutkan dari file installer terbaru
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
        }).sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

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
        res.sendFile(filePath);
      } else {
        res.status(404).send('Update file not found');
      }
    });

    // API: Memicu update remote pada Agent (satu PC atau semua PC)
    this.app.post('/api/updates/trigger-agent', (req, res) => {
      const { targetUuid, downloadUrl } = req.body || {};
      if (!downloadUrl) return res.status(400).json({ success: false, error: 'URL unduhan diperlukan' });

      // Jika URL relatif, ubah ke URL lengkap berbasis IP Server
      let fullDownloadUrl = downloadUrl;
      if (fullDownloadUrl.startsWith('/')) {
        const host = req.headers.host || `localhost:${this.port}`;
        const protocol = req.protocol || 'http';
        fullDownloadUrl = `${protocol}://${host}${fullDownloadUrl}`;
      }

      this.telemetryHub.triggerAgentUpdate(targetUuid || 'all', fullDownloadUrl);
      logger.info(`[UpdateHub] Memicu pembaruan Agent ke target: ${targetUuid || 'all'} (URL: ${fullDownloadUrl})`);
      res.json({ success: true, message: 'Perintah pembaruan disiarkan ke Agent', downloadUrl: fullDownloadUrl });
    });

    // API: Upload installer Agent baru ke Server
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
