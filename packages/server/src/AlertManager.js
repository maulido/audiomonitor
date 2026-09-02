let TelegramBot = require('node-telegram-bot-api');
const logger = require('./utils/logger');
if (TelegramBot.default) TelegramBot = TelegramBot.default;

class AlertManager {
  constructor(configManager, dbManager) {
    this.configManager = configManager;
    this.dbManager = dbManager;
    this.bot = null;
    this.lastAlertState = {};
    this.THROTTLE_MS = 60000;
    this.initBot();
  }

  initBot() {
    const telegramConfig = this.configManager.getTelegramConfig();
    if (telegramConfig && telegramConfig.token) {
      try {
        this.bot = new TelegramBot(telegramConfig.token, { polling: false });
        logger.info('[Telegram] Bot Telegram berhasil diinisialisasi.');
      } catch (err) {
        logger.error(`[Telegram] Gagal menginisialisasi bot Telegram: ${err.message}`);
        this.bot = null;
      }
    } else {
      this.bot = null;
      logger.info('[Telegram] Token Telegram kosong di konfigurasi. Notifikasi bot dinonaktifkan.');
    }
  }

  sendTelegramAlert(message) {
    const telegramConfig = this.configManager.getTelegramConfig();
    if (this.bot && telegramConfig.chatId) {
      this.bot.sendMessage(telegramConfig.chatId, message, { parse_mode: 'HTML' })
        .then(() => {
          logger.info(`[Telegram] Notifikasi terkirim ke Chat ID ${telegramConfig.chatId}`);
        })
        .catch(err => logger.error(`[Telegram] Gagal mengirim pesan Telegram: ${err ? err.message : 'Unknown error'}`));
    }
  }

  escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  processTelemetry(data, pcName) {
    if (!data || typeof data.status !== 'string') return;

    const isDanger = data.status.startsWith('BAHAYA');
    const safePcName = this.escapeHtml(pcName);
    const safeStatus = this.escapeHtml(data.status.replace(/_/g, ' '));
    
    if (isDanger) {
      const state = this.lastAlertState[data.uuid] || { time: 0, status: null, notified: false };
      const now = Date.now();
      const throttleMs = (this.configManager.getTelegramConfig().interval ?? 60) * 1000;
      const isNewDanger = state.status !== data.status;
      const canSendAlert = now - state.time > throttleMs;

      if (isNewDanger) {
        logger.warn(`[AlertManager] Insiden audio terdeteksi pada PC ${pcName}: ${data.status}`);
      }

      if (canSendAlert) {
        this.sendTelegramAlert(
          `[ALERT] <b>AUDIO ISSUE</b>\n<b>${safePcName}</b> mengalami masalah: <b>${safeStatus}</b>`
        );
        if (isNewDanger && this.dbManager) {
          this.dbManager.logIncident(data.uuid, pcName, data.status, 'Audio/OBS Issue Detected');
        }
        this.lastAlertState[data.uuid] = { time: now, status: data.status, notified: true };
      } else if (isNewDanger) {
         this.lastAlertState[data.uuid] = { ...state, status: data.status };
      }
    } else if (!isDanger && this.lastAlertState[data.uuid] && this.lastAlertState[data.uuid].status && this.lastAlertState[data.uuid].status.startsWith('BAHAYA')) {
      logger.info(`[AlertManager] Status audio PC ${pcName} pulih kembali normal (${data.status})`);
      if (this.lastAlertState[data.uuid].notified) {
        this.sendTelegramAlert(`[OK] <b>${safePcName}</b> audio sudah kembali normal.`);
        if (this.dbManager) this.dbManager.logIncident(data.uuid, pcName, 'RECOVERY', 'Audio kembali normal');
      }
      this.lastAlertState[data.uuid].status = data.status;
      this.lastAlertState[data.uuid].notified = false;
    } else if (!isDanger && this.lastAlertState[data.uuid]) {
      this.lastAlertState[data.uuid].status = data.status;
      this.lastAlertState[data.uuid].notified = false;
    }
  }

  processOffline(uuid, pcName) {
    const safePcName = this.escapeHtml(pcName);
    logger.warn(`[AlertManager] PC Host ${pcName} (${uuid}) terdeteksi OFFLINE`);
    this.sendTelegramAlert(`[OFFLINE] <b>${safePcName}</b> terputus dari jaringan.`);
    if (this.dbManager) this.dbManager.logIncident(uuid, pcName, 'OFFLINE', 'Koneksi terputus');
    
    if (this.lastAlertState[uuid]) {
      this.lastAlertState[uuid].status = 'OFFLINE';
    } else {
      this.lastAlertState[uuid] = { status: 'OFFLINE', time: Date.now(), notified: false };
    }
    delete this.lastAlertState[`${uuid}_hw`];
  }
}

module.exports = AlertManager;
