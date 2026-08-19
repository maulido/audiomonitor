const path = require('path');
const fs = require('fs');

class DatabaseManager {
  constructor(dbName = 'incidents.json') {
    let basePath = path.resolve(__dirname, '../');
    if (process.versions && process.versions.electron) {
      basePath = path.dirname(process.execPath);
    } else if (process.pkg) {
      basePath = path.dirname(process.execPath);
    }
    const dbDir = path.join(basePath, 'data');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    this.dbPath = path.join(dbDir, dbName);
    this.incidents = [];
    this.nextId = 1;
    this.loadDb();
    console.log('Connected to JSON database.');
  }

  loadDb() {
    if (fs.existsSync(this.dbPath)) {
      try {
        const data = fs.readFileSync(this.dbPath, 'utf8');
        this.incidents = JSON.parse(data);
        if (this.incidents.length > 0) {
          this.nextId = Math.max(...this.incidents.map(i => i.id)) + 1;
        }
      } catch (err) {
        console.error('Error reading JSON DB:', err.message);
        this.incidents = [];
      }
    }
    this.autoCleanup();
  }

  saveDb() {
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      try {
        const tempPath = this.dbPath + '.tmp';
        require('fs').writeFileSync(tempPath, JSON.stringify(this.incidents, null, 2));
        require('fs').renameSync(tempPath, this.dbPath);
      } catch (err) {
        console.error('Error saving JSON DB:', err.message);
      }
    }, 500);
  }

  autoCleanup() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const initialLength = this.incidents.length;
    this.incidents = this.incidents.filter(i => new Date(i.timestamp) >= thirtyDaysAgo);
    
    if (this.incidents.length !== initialLength) {
      console.log('Auto-cleanup: Removed old incidents.');
      this.saveDb();
    }
  }

  logIncident(uuid, pcName, incidentType, details) {
    const incident = {
      id: this.nextId++,
      uuid,
      pcName,
      incidentType,
      details,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };
    this.incidents.push(incident);
    this.saveDb();
  }

  getRecentIncidents(limit = 100, callback) {
    const sorted = [...this.incidents].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    callback(sorted.slice(0, limit));
  }

  clearIncidents(callback) {
    this.incidents = [];
    this.saveDb();
    if (callback) callback(null);
  }
}

module.exports = DatabaseManager;
