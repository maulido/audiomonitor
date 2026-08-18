const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class DatabaseManager {
  constructor(dbName = 'incidents.sqlite') {
    const dbDir = process.pkg ? path.join(path.dirname(process.execPath), 'data') : path.resolve(__dirname, '../data');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    this.dbPath = path.join(dbDir, dbName);
    this.db = new sqlite3.Database(this.dbPath, (err) => {
      if (err) {
        console.error('Error opening database:', err.message);
      } else {
        console.log('Connected to SQLite database.');
        this.initTables();
      }
    });
  }

  initTables() {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL,
        pcName TEXT NOT NULL,
        incidentType TEXT NOT NULL,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    this.db.run(createTableQuery, (err) => {
      if (err) {
        console.error('Error creating table:', err.message);
      } else {
        this.autoCleanup();
      }
    });
  }

  autoCleanup() {
    // Delete logs older than 30 days
    const query = `DELETE FROM incidents WHERE timestamp < datetime('now', '-30 days')`;
    this.db.run(query, function(err) {
      if (err) {
        console.error('Failed to auto-cleanup old incidents:', err.message);
      } else if (this.changes > 0) {
        console.log(`Auto-cleanup: Removed ${this.changes} old incidents from database.`);
      }
    });
  }

  logIncident(uuid, pcName, incidentType, details) {
    const query = `INSERT INTO incidents (uuid, pcName, incidentType, details) VALUES (?, ?, ?, ?)`;
    this.db.run(query, [uuid, pcName, incidentType, details], function(err) {
      if (err) {
        console.error('Error logging incident:', err.message);
      }
    });
  }

  getRecentIncidents(limit = 100, callback) {
    const query = `SELECT * FROM incidents ORDER BY timestamp DESC LIMIT ?`;
    this.db.all(query, [limit], (err, rows) => {
      if (err) {
        console.error('Error fetching incidents:', err.message);
        callback([]);
      } else {
        callback(rows);
      }
    });
  }

  clearIncidents(callback) {
    const query = `DELETE FROM incidents`;
    this.db.run(query, (err) => {
      if (err) {
        console.error('Error clearing incidents:', err.message);
        if (callback) callback(err);
      } else {
        if (callback) callback(null);
      }
    });
  }
}

module.exports = DatabaseManager;
