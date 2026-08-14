const express = require('express');
const http = require('http');
const cors = require('cors');

const ConfigManager = require('./ConfigManager');
const AlertManager = require('./AlertManager');
const TelemetryHub = require('./TelemetryHub');

class ServerApp {
  constructor(port = 4000) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Initialize Core Modules
    this.configManager = new ConfigManager();
    this.alertManager = new AlertManager(this.configManager);
    this.telemetryHub = new TelemetryHub(this.server, this.configManager, this.alertManager);

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
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
  }

  start() {
    this.server.listen(this.port, () => {
      console.log(`Central Server running on port ${this.port}`);
    });
  }
}

module.exports = ServerApp;
