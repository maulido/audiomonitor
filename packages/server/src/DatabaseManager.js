const path = require('path');
const fs = require('fs');

/**
 * Class DatabaseManager
 * Bertugas merekam riwayat (log) insiden ke dalam file JSON agar jejak error (audio mati/pecah)
 * tidak hilang meski aplikasi direstart. Mendukung auto-cleanup agar file tidak bengkak.
 */
class DatabaseManager {
  /**
   * Menyiapkan direktori 'data' di samping EXE aplikasi Server.
   * @param {string} dbName - Nama file penyimpanan.
   */
  constructor(dbName = 'incidents.json') {
    let basePath = path.resolve(__dirname, '../');
    if (process.versions && process.versions.electron) {
      basePath = path.dirname(process.execPath);
    } else if (process.pkg) {
      basePath = path.dirname(process.execPath);
    }
    
    // Buat folder 'data' jika belum ada
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

  /**
   * Memuat isi file JSON ke dalam memori (array incidents).
   */
  loadDb() {
    if (fs.existsSync(this.dbPath)) {
      try {
        const data = fs.readFileSync(this.dbPath, 'utf8');
        this.incidents = JSON.parse(data);
        if (this.incidents.length > 0) {
          // Lanjutkan penomoran ID dari angka tertinggi
          this.nextId = Math.max(...this.incidents.map(i => i.id)) + 1;
        }
      } catch (err) {
        console.error('Error reading JSON DB:', err.message);
        this.incidents = [];
      }
    }
    this.autoCleanup(); // Segera bersihkan data kadaluarsa saat startup
  }

  /**
   * Menyimpan array incidents kembali ke file.
   * Menggunakan teknik "Debouncing" (ditunda 500ms) untuk mencegah penyimpanan yang terlalu sering (IO bottleneck) 
   * jika terjadi banyak insiden secara bersamaan.
   */
  saveDb() {
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      try {
        // Tulis ke file temp lalu rename (Atomic Write) mencegah file corrupt kalau lampu mati di tengah proses
        const tempPath = this.dbPath + '.tmp';
        require('fs').writeFileSync(tempPath, JSON.stringify(this.incidents, null, 2));
        require('fs').renameSync(tempPath, this.dbPath);
      } catch (err) {
        console.error('Error saving JSON DB:', err.message);
      }
    }, 500);
  }

  /**
   * Otomatis membuang riwayat insiden yang usianya sudah lebih dari 30 hari
   * agar aplikasi tidak kehabisan RAM/Storage dalam jangka panjang.
   */
  autoCleanup(retentionDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const initialLength = this.incidents.length;
    this.incidents = this.incidents.filter(i => new Date(i.timestamp) >= cutoffDate);
    
    if (this.incidents.length !== initialLength) {
      console.log('Auto-cleanup: Removed old incidents.');
      this.saveDb();
    }
  }

  /**
   * Mencatat insiden baru.
   * @param {string} uuid - ID dari PC yang bermasalah.
   * @param {string} pcName - Nama alias PC.
   * @param {string} incidentType - Tipe kejadian (BAHAYA_MUTE, AMAN, OFFLINE).
   * @param {string} details - Catatan detail tentang kejadian tersebut.
   */
  logIncident(uuid, pcName, incidentType, details) {
    const incident = {
      id: this.nextId++,
      uuid,
      pcName,
      incidentType,
      details,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19) // Format: YYYY-MM-DD HH:MM:SS
    };
    this.incidents.push(incident);
    this.saveDb();
  }

  /**
   * Mengambil sejumlah daftar insiden terbaru (diurutkan dari yang paling akhir).
   */
  getRecentIncidents(limit = 100, callback) {
    const sorted = [...this.incidents].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    callback(sorted.slice(0, limit));
  }

  /**
   * Menghapus seluruh memori insiden secara total (Reset dari Dashboard).
   */
  clearIncidents(callback) {
    this.incidents = [];
    this.saveDb();
    if (callback) callback(null);
  }
}

module.exports = DatabaseManager;
