const fs = require('fs');
const path = require('path');

/**
 * Class ConfigManager
 * Berfungsi sebagai pengelola penyimpanan data persisten (Storage).
 * Mengatur baca-tulis file JSON untuk pengaturan global Server, 
 * seperti daftar nama PC, PIN Dashboard, dan kunci Telegram.
 */
class ConfigManager {
  /**
   * Menginisialisasi letak file konfigurasi berdasarkan lingkungan jalannya aplikasi 
   * (saat masa pengembangan/dev vs saat sudah menjadi EXE/prod).
   * @param {string} configFilePath - Nama file (default: config.json).
   */
  constructor(configFilePath = 'config.json') {
    let basePath = path.resolve(__dirname, '../');
    
    // Mendeteksi apakah aplikasi sedang dibungkus di dalam Electron atau pkg
    // Agar file config.json selalu tersimpan di sebelah file EXE, bukan di dalam direktori internal sistem
    if (process.versions && process.versions.electron) {
      basePath = path.dirname(process.execPath);
    } else if (process.pkg) {
      basePath = path.dirname(process.execPath);
    }
    
    this.configPath = path.isAbsolute(configFilePath) ? configFilePath : path.join(basePath, configFilePath);
    
    // Struktur baku sistem (Defaults)
    this.defaultConfig = {
      pcMapping: {}, // Menyimpan kamus relasi antara UUID yang jelek -> Nama PC yang bagus
      telegram: { token: '', chatId: '', interval: 60 },
      monitoringActive: true,
      dashboardPin: '1234',
      logRetentionDays: 30,
      recordDir: '',
      transcription: {
        enabled: false,
        apiUrl: '',
        apiKey: '',
        language: 'id',
        autoTranscribe: true,
        alertKeywords: []
      }
    };
    
    this.config = { ...this.defaultConfig };
    this.loadConfig();
  }

  /**
   * Membaca pengaturan dari sistem penyimpanan lokal (Hard Disk).
   * Melakukan penggabungan mendalam (Deep Merge) jika ada file lama yang kehilangan properti baru.
   */
  loadConfig() {
    if (fs.existsSync(this.configPath)) {
      try {
        const fileContent = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(fileContent);
        
        // Deep merge untuk mencegah error jika objek 'telegram' kosong/hilang dari file JSON lama
        this.config = {
          pcMapping: parsed.pcMapping || {},
          telegram: {
            token: '',
            chatId: '',
            interval: 60,
            ...(parsed.telegram || {})
          },
          monitoringActive: parsed.monitoringActive !== undefined ? parsed.monitoringActive : true,
          dashboardPin: parsed.dashboardPin || '1234',
          logRetentionDays: parsed.logRetentionDays !== undefined ? parsed.logRetentionDays : 30,
          recordDir: parsed.recordDir || '',
          transcription: {
            enabled: false,
            apiUrl: '',
            apiKey: '',
            language: 'id',
            autoTranscribe: true,
            alertKeywords: [],
            ...(parsed.transcription || {})
          }
        };
      } catch (err) {
        console.error('Error reading config file:', err.message);
        try {
          const backupPath = `${this.configPath}.corrupt_${Date.now()}`;
          fs.copyFileSync(this.configPath, backupPath);
          console.warn(`Corrupted config backed up to: ${backupPath}`);
        } catch (bErr) {}
        this.config = { 
          ...this.defaultConfig, 
          telegram: { ...this.defaultConfig.telegram },
          transcription: { ...this.defaultConfig.transcription }
        };
      }
    } else {
      this.saveConfig();
    }
  }

  /**
   * Menulis struktur memori saat ini (Object config) langsung ke dalam file JSON secara atomik.
   */
  saveConfig() {
    try {
      const tempPath = `${this.configPath}.tmp_${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(this.config, null, 2));
      try {
        if (fs.existsSync(this.configPath)) {
          try { fs.unlinkSync(this.configPath); } catch (e) {}
        }
        fs.renameSync(tempPath, this.configPath);
      } catch (rnErr) {
        fs.copyFileSync(tempPath, this.configPath);
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
    } catch (err) {
      console.error('Error saving config file:', err);
    }
  }

  /**
   * Mengonversi UUID jelek (contoh: 53a2-df92...) menjadi nama yang sudah disetel user (PC-Studio-1).
   * @param {string} uuid - ID Asli.
   * @returns {string} Nama Alias PC, atau UUID aslinya jika belum diberi nama.
   */
  getPcName(uuid) {
    return (this.config.pcMapping && this.config.pcMapping[uuid]) || uuid;
  }

  /**
   * Mendaftarkan nama baru untuk sebuah PC dan menyimpannya.
   */
  setPcName(uuid, name) {
    if (!this.config.pcMapping) this.config.pcMapping = {};
    this.config.pcMapping[uuid] = name;
    this.saveConfig();
  }

  /**
   * Menghapus sebuah PC dari ingatan Server (biasanya saat user menghapus manual dari Dashboard).
   */
  deletePcMapping(uuid) {
    if (this.config.pcMapping && Object.prototype.hasOwnProperty.call(this.config.pcMapping, uuid)) {
      delete this.config.pcMapping[uuid];
      this.saveConfig();
    }
  }

  /**
   * Mengambil semua direktori terdaftar PC yang ada.
   */
  getAllPcMappings() {
    return this.config.pcMapping || {};
  }

  /**
   * Mengambil aturan kunci bot telegram.
   */
  getTelegramConfig() {
    return this.config.telegram || { token: '', chatId: '', interval: 60 };
  }

  /**
   * Mengambil konfigurasi integrasi Whisper Speech-to-Text.
   */
  getTranscriptionConfig() {
    return this.config.transcription || { ...this.defaultConfig.transcription };
  }

  /**
   * Memperbarui konfigurasi integrasi Whisper Speech-to-Text.
   */
  setTranscriptionConfig(transcriptionData = {}) {
    this.config.transcription = {
      ...this.getTranscriptionConfig(),
      ...transcriptionData
    };
    this.saveConfig();
  }
}

module.exports = ConfigManager;
