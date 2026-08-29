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
        const parsed = JSON.parse(data);
        this.incidents = Array.isArray(parsed) ? parsed : [];
        if (this.incidents.length > 0) {
          // Lanjutkan penomoran ID dari angka tertinggi secara aman
          this.nextId = this.incidents.reduce((max, i) => Math.max(max, Number(i.id) || 0), 0) + 1;
        }
      } catch (err) {
        console.error('Error reading JSON DB:', err.message);
        this.incidents = [];
      }
    }
    // autoCleanup dipanggil oleh ServerApp setelah config dimuat
  }

  /**
   * Menyimpan array incidents kembali ke file.
   * Menggunakan teknik "Debouncing" (ditunda 500ms) untuk mencegah penyimpanan yang terlalu sering (IO bottleneck) 
   * jika terjadi banyak insiden secara bersamaan.
   */
  saveDb() {
    if (this._saveTimeout) return;
    this._saveTimeout = setTimeout(() => {
      this._saveTimeout = null;
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
    if (retentionDays <= 0 || isNaN(retentionDays)) retentionDays = 30;
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
   * Mengambil insiden dengan filter tanggal, nama PC, dan tipe status.
   * @param {Object} filters - { startDate, endDate, pcName, status, limit }
   * @param {Function} callback - Callback dengan hasil array insiden.
   */
  getFilteredIncidents(filters = {}, callback) {
    let result = [...this.incidents];

    if (filters.startDate) {
      const start = new Date(filters.startDate);
      if (!isNaN(start.getTime())) {
        result = result.filter(i => new Date(i.timestamp) >= start);
      }
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      if (!isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        result = result.filter(i => new Date(i.timestamp) <= end);
      }
    }
    if (filters.pcName) {
      result = result.filter(i => i.pcName === filters.pcName);
    }
    if (filters.status) {
      const s = String(filters.status).toUpperCase();
      result = result.filter(i => (i.incidentType || '').toUpperCase().includes(s));
    }

    result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limit = Math.max(1, parseInt(filters.limit, 10) || 500);
    if (typeof callback === 'function') {
      callback(result.slice(0, limit));
    }
  }

  /**
   * Mengambil daftar unik nama PC yang pernah tercatat insiden.
   */
  getUniquePcNames() {
    const names = new Set(this.incidents.map(i => i.pcName).filter(Boolean));
    return [...names].sort();
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
