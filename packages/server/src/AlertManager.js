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
        logger.info('Telegram Bot initialized.');
      } catch (err) {
        logger.error('Failed to initialize Telegram Bot:', err);
        this.bot = null;
      }
    } else {
      this.bot = null;
      logger.info('No Telegram token found in config. Bot alerts disabled.');
    }
  }

  sendTelegramAlert(message) {
    const telegramConfig = this.configManager.getTelegramConfig();
    if (this.bot && telegramConfig.chatId) {
      this.bot.sendMessage(telegramConfig.chatId, message, { parse_mode: 'HTML' })
        .catch(err => logger.error('Telegram error:', err ? err.message : "Unknown error"));
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
    } else if (data.status === 'AMAN' && this.lastAlertState[data.uuid] && this.lastAlertState[data.uuid].status !== 'AMAN') {
      if (this.lastAlertState[data.uuid].notified) {
        this.sendTelegramAlert(`[OK] <b>${safePcName}</b> audio sudah kembali AMAN.`);
        if (this.dbManager) this.dbManager.logIncident(data.uuid, pcName, 'RECOVERY', 'Audio kembali AMAN');
      }
      this.lastAlertState[data.uuid].status = 'AMAN';
      this.lastAlertState[data.uuid].notified = false;
    } else if (!isDanger && data.status !== 'AMAN' && this.lastAlertState[data.uuid] && this.lastAlertState[data.uuid].status !== 'STANDBY') {
      this.lastAlertState[data.uuid].status = 'STANDBY';
      this.lastAlertState[data.uuid].notified = false;
    }
  }

  processOffline(uuid, pcName) {
    const safePcName = this.escapeHtml(pcName);
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
