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
    
    // Middleware Keamanan PIN khusus rute API
    // Memastikan siapa pun yang mengirim POST/DELETE/PUT ke API harus menyertakan PIN di header
    this.app.use('/api', (req, res, next) => {
      if (['POST', 'DELETE', 'PUT'].includes(req.method)) {
        const pin = req.headers['x-pin'];
        const correctPin = this.configManager.config.dashboardPin || '1234';
        if (pin !== correctPin) {
          return res.status(401).json({ success: false, error: 'Unauthorized', message: 'PIN Salah' });
        }
      }
      next(); // Jika method GET atau PIN benar, lanjutkan
    });
    
    // Menyajikan antarmuka Dashboard (React Build) agar bisa diakses via Browser (http://localhost:4000)
    const path = require('path');
    const dashboardPath = path.join(__dirname, '../dashboard-dist');
    this.app.use(express.static(dashboardPath));
  }

  /**
   * Mendaftarkan seluruh rute (endpoints) API HTTP.
   * Digunakan oleh Dashboard untuk mengubah pengaturan atau mengambil data riwayat.
   */
  setupRoutes() {
    
    // API: Mengambil log harian dari file log
    this.app.get('/api/logs', (req, res) => {
      const logger = require('./utils/logger');
      res.send({ success: true, logs: logger.getTodayLogs() });
    });
    
    // API: Menghapus sebuah PC (Agent) dari daftar Dashboard
    this.app.delete('/api/pc/:uuid', (req, res) => {
      // Validasi PIN sekali lagi untuk proteksi ganda (meski sudah ada middleware)
      const pin = req.headers['x-pin'];
      if (!pin || pin !== this.configManager.config.dashboardPin) {
        return res.status(401).json({ error: 'Invalid PIN' });
      }
      const { uuid } = req.params;
      this.telemetryHub.deleteAgent(uuid);
      delete this.configManager.config.pcMapping[uuid];
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

    // API: Mengambil riwayat insiden (Log Error) dari database SQLite
    this.app.get('/api/incidents', (req, res) => {
      const limit = parseInt(req.query.limit) || 100;
      this.dbManager.getRecentIncidents(limit, (rows) => {
        res.send(rows);
      });
    });

    // API: Menghapus seluruh riwayat insiden
    this.app.delete('/api/incidents', (req, res) => {
      this.dbManager.clearIncidents((err) => {
        if (err) return res.status(500).send({ success: false, error: err.message });
        res.send({ success: true });
      });
    });

    // API: Menyimpan pengaturan kunci (Token & Chat ID) Telegram
    this.app.post('/api/config/telegram', (req, res) => {
      const { token, chatId, interval, logRetentionDays } = req.body || {};
      if (logRetentionDays !== undefined) {
        this.configManager.config.logRetentionDays = parseInt(logRetentionDays, 10) || 30;
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
      
      this.alertManager.initBot(); // Muat ulang bot dengan token baru
      
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
