const express = require('express');
const http = require('http');
const cors = require('cors');

const ConfigManager = require('./ConfigManager');
const DatabaseManager = require('./DatabaseManager');
const AlertManager = require('./AlertManager');
const TelemetryHub = require('./TelemetryHub');

class ServerApp {
  constructor(port = 4000) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Initialize Core Modules
    this.configManager = new ConfigManager();
    this.dbManager = new DatabaseManager();
    this.alertManager = new AlertManager(this.configManager, this.dbManager);
    this.telemetryHub = new TelemetryHub(this.server, this.configManager, this.alertManager);

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Security PIN Middleware for API
    this.app.use('/api', (req, res, next) => {
      const pin = req.headers['x-pin'];
      const correctPin = this.configManager.config.dashboardPin || '1234';
      if (pin !== correctPin) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'PIN Salah' });
      }
      next();
    });
    
    // Serve dashboard static files
    const path = require('path');
    const dashboardPath = path.join(__dirname, '../dashboard-dist');
    this.app.use(express.static(dashboardPath));
  }

  setupRoutes() {
    // API for Dashboard to rename PCs
    this.app.post('/api/rename', (req, res) => {
      const { uuid, newName } = req.body;
      if (!uuid || !newName) return res.status(400).send({ success: false, error: 'Invalid data' });
      
      this.configManager.setPcName(uuid, newName);
      res.send({ success: true, pcMapping: this.configManager.getAllPcMappings() });
    });

    this.app.get('/api/config', (req, res) => {
      res.send(this.configManager.config);
    });

    this.app.get('/api/incidents', (req, res) => {
      const limit = parseInt(req.query.limit) || 100;
      this.dbManager.getRecentIncidents(limit, (rows) => {
        res.send(rows);
      });
    });

    this.app.delete('/api/incidents', (req, res) => {
      this.dbManager.clearIncidents((err) => {
        if (err) return res.status(500).send({ success: false, error: err.message });
        res.send({ success: true });
      });
    });

    this.app.post('/api/config/telegram', (req, res) => {
      const { token, chatId, interval } = req.body || {};
      if (token !== undefined) this.configManager.config.telegram.token = token;
      if (chatId !== undefined) this.configManager.config.telegram.chatId = chatId;
      if (interval !== undefined) this.configManager.config.telegram.interval = parseInt(interval, 10);
      this.configManager.saveConfig();
      this.alertManager.initBot(); // Re-initialize the bot
      
      // Broadcast new config to all agents for offline fallback
      this.telemetryHub.io.to('agents').emit('telegram-config', this.configManager.getTelegramConfig());
      
      res.send({ success: true, telegram: this.configManager.config.telegram });
    });

    this.app.post('/api/config/monitoring', (req, res) => {
      const { active } = req.body;
      this.configManager.config.monitoringActive = active;
      this.configManager.saveConfig();
      // Broadcast to all dashboards
      this.telemetryHub.io.emit('monitoring-status', active);
      res.send({ success: true, monitoringActive: active });
    });

    this.app.post('/api/config/pin', (req, res) => {
      const { newPin } = req.body;
      if (!newPin || newPin.length < 4) return res.status(400).json({ error: 'PIN minimal 4 karakter' });
      this.configManager.config.dashboardPin = newPin;
      this.configManager.saveConfig();
      res.send({ success: true });
    });

    this.app.post('/api/pc/:uuid/monitoring', (req, res) => {
      const { uuid } = req.params;
      const { active } = req.body;
      
      // Server is source of truth — update state, notify agent AND dashboards
      this.telemetryHub.setPcMonitoring(uuid, active);
      
      res.send({ success: true, active });
    });

    this.app.post('/api/telegram/test', (req, res) => {
      this.alertManager.sendTelegramAlert('[TEST] <b>Ping!</b> Ini adalah pesan percobaan dari AudioMonitor Server.');
      res.json({ success: true, message: 'Test message sent' });
    });
  }

  start(onError) {
    this.server.on('error', (e) => {
      if (onError) onError(e);
      else console.error('Server error:', e);
    });
    this.server.listen(this.port, () => {
      console.log(`Central Server running on port ${this.port}`);
    });
  }
}

module.exports = ServerApp;
