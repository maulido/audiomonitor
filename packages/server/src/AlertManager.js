let TelegramBot = require('node-telegram-bot-api');
const logger = require('./utils/logger');
if (TelegramBot.default) TelegramBot = TelegramBot.default;

/**
 * Class AlertManager
 * Bertanggung jawab penuh atas pengiriman notifikasi (khususnya via Telegram) 
 * dan pencatatan insiden ke dalam sistem database lokal jika terjadi masalah pada Agent.
 */
class AlertManager {
  /**
   * Konstruktor untuk inisialisasi AlertManager.
   * @param {Object} configManager - Referensi ke ConfigManager untuk membaca Token & ChatID Telegram.
   * @param {Object} dbManager - Referensi ke DatabaseManager untuk menyimpan log insiden (riwayat eror).
   */
  constructor(configManager, dbManager) {
    this.configManager = configManager;
    this.dbManager = dbManager;
    this.bot = null;
    
    // Menyimpan rekam jejak waktu notifikasi terakhir dikirim per Agent 
    // agar bot tidak melakukan spam pesan jika error terjadi terus-menerus.
    this.lastAlertState = {};
    
    this.THROTTLE_MS = 60000;

    this.initBot();
  }

  /**
   * Menginisialisasi Bot Telegram menggunakan token yang ada di config.json.
   * Jika token tidak ada/salah, fitur Telegram akan otomatis dimatikan tanpa error fatal.
   */
  initBot() {
    const telegramConfig = this.configManager.getTelegramConfig();
    if (telegramConfig && telegramConfig.token) {
      try {
        // Polling dibuat false karena kita hanya butuh MENGIRIM pesan (bukan membalas perintah/chat masuk)
        this.bot = new TelegramBot(telegramConfig.token, { polling: false });
        logger.info('Telegram Bot initialized.');
      } catch (err) {
        logger.error('Failed to initialize Telegram Bot:', err);
        this.bot = null;
      }
    } else {
      // Pastikan objek bot disetel null jika tidak ada token
      this.bot = null;
      logger.info('No Telegram token found in config. Bot alerts disabled.');
    }
  }

  /**
   * Mengirim pesan peringatan nyata ke obrolan (chat) Telegram.
   * Menggunakan format parse_mode 'HTML' untuk menghindari crash akibat karakter aneh seperti '_'.
   * @param {string} message - Pesan yang sudah diformat untuk dikirim.
   */
  sendTelegramAlert(message) {
    const telegramConfig = this.configManager.getTelegramConfig();
    if (this.bot && telegramConfig.chatId) {
      this.bot.sendMessage(telegramConfig.chatId, message, { parse_mode: 'HTML' })
        .catch(err => logger.error('Telegram error:', err ? err.message : "Unknown error"));
    }
  }

  /**
   * Mengamankan teks dinamis (seperti Nama PC) agar tidak merusak format HTML Telegram.
   * @param {string} text - Teks mentah.
   * @returns {string} Teks yang aman.
   */
  escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Menganalisis paket telemetri yang datang dari Agent.
   * Menentukan apakah statusnya mengindikasikan bahaya (Mute/Pecah) lalu mengirim Telegram jika iya.
   * @param {Object} data - Payload telemetri dari Agent.
   * @param {string} pcName - Nama PC Agent pengirim.
   */
  processTelemetry(data, pcName) {
    if (!data || typeof data.status !== 'string') return; // Defensive check

    const isDanger = data.status.startsWith('BAHAYA');
    const safePcName = this.escapeHtml(pcName);
    const safeStatus = this.escapeHtml(data.status.replace(/_/g, ' '));
    
    if (isDanger) {
      const state = this.lastAlertState[data.uuid] || { time: 0, status: null };
      const now = Date.now();
      
      // Batas waktu jeda (throttle) didapatkan dari konfigurasi interval di UI Dashboard
      const throttleMs = (this.configManager.getTelegramConfig().interval ?? 60) * 1000;
      
      const isNewDanger = state.status !== data.status;
      
      if (isNewDanger || now - state.time > throttleMs) {
        this.sendTelegramAlert(
          `[ALERT] <b>AUDIO ISSUE</b>\n<b>${safePcName}</b> mengalami masalah: <b>${safeStatus}</b>`
        );
        // Catat kejadian bahaya ke dalam Log / SQLite DB HANYA jika ini bahaya baru (jangan spam db tiap menit)
        if (isNewDanger && this.dbManager) {
          this.dbManager.logIncident(data.uuid, pcName, data.status, 'Audio/OBS Issue Detected');
        }
        this.lastAlertState[data.uuid] = { time: now, status: data.status };
      }
    } else if (data.status === 'AMAN' && this.lastAlertState[data.uuid]) {
      // Jika statusnya membaik menjadi AMAN, kirimkan notifikasi Recovery
      this.sendTelegramAlert(`[OK] <b>${safePcName}</b> audio sudah kembali AMAN.`);
      if (this.dbManager) this.dbManager.logIncident(data.uuid, pcName, 'RECOVERY', 'Audio kembali AMAN');
      delete this.lastAlertState[data.uuid];
    } else if (!isDanger && data.status !== 'AMAN' && this.lastAlertState[data.uuid]) {
      // Jika statusnya tidak bahaya dan bukan AMAN (contohnya STANDBY/DIAM), hapus timer penahan notifikasi
      delete this.lastAlertState[data.uuid];
    }

    // Pengecekan Perangkat Keras CPU/RAM
    // Sengaja dinonaktifkan atas permintaan (Agustus 21, 2026) karena terlalu berisik (spammy).
    /*
    if (data.cpuUsage > 85 || data.ramUsage > 85) {
      ...
    }
    */
  }

  /**
   * Menangani peristiwa ketika koneksi Agent PC terputus (mati lampu, restart, dsb).
   * @param {string} uuid - UUID PC yang mati.
   * @param {string} pcName - Nama PC yang mati.
   */
  processOffline(uuid, pcName) {
    const safePcName = this.escapeHtml(pcName);
    this.sendTelegramAlert(`[OFFLINE] <b>${safePcName}</b> terputus dari jaringan.`);
    if (this.dbManager) this.dbManager.logIncident(uuid, pcName, 'OFFLINE', 'Koneksi terputus');
    
    // Bersihkan status notifikasi sebelumnya untuk PC ini
    delete this.lastAlertState[uuid];
    delete this.lastAlertState[`${uuid}_hw`];
  }
}

module.exports = AlertManager;
