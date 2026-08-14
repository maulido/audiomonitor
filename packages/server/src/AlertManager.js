const TelegramBot = require('node-telegram-bot-api');

class AlertManager {
  constructor(configManager) {
    this.configManager = configManager;
    this.bot = null;
    this.lastAlertState = {}; // To prevent spamming
    this.THROTTLE_MS = 60000; // 60 seconds

    this.initBot();
  }

  initBot() {
    const telegramConfig = this.configManager.getTelegramConfig();
    if (telegramConfig && telegramConfig.token) {
      try {
        this.bot = new TelegramBot(telegramConfig.token, { polling: false });
        console.log('Telegram Bot initialized.');
      } catch (err) {
        console.error('Failed to initialize Telegram Bot:', err);
      }
    } else {
      console.log('No Telegram token found in config. Bot alerts disabled.');
    }
  }

  sendTelegramAlert(message) {
    const telegramConfig = this.configManager.getTelegramConfig();
    if (this.bot && telegramConfig.chatId) {
      this.bot.sendMessage(telegramConfig.chatId, `🚨 *AUDIO ALERT* 🚨\n${message}`, { parse_mode: 'Markdown' })
        .catch(err => console.error("Telegram error:", err));
    }
  }

  processTelemetry(data, pcName) {
    if (data.status !== 'AMAN' && data.status !== 'MIC_MATI_ATAU_DIAM') {
      const lastAlertTime = this.lastAlertState[data.uuid] || 0;
      const now = Date.now();
      
      // Send alert if it's the first time or enough time has passed
      if (now - lastAlertTime > this.THROTTLE_MS) {
        let msg = `*${pcName}* mengalami masalah: *${data.status}*`;
        this.sendTelegramAlert(msg);
        this.lastAlertState[data.uuid] = now;
      }
    } else if (data.status === 'AMAN' && this.lastAlertState[data.uuid]) {
      // It recovered
      this.sendTelegramAlert(`✅ *${pcName}* audio sudah kembali AMAN.`);
      delete this.lastAlertState[data.uuid];
    }
  }

  processOffline(uuid, pcName) {
    this.sendTelegramAlert(`🔌 *${pcName}* terputus dari jaringan (OFFLINE).`);
    // Reset alert state so it can alert again when it reconnects and fails
    delete this.lastAlertState[uuid];
  }
}

module.exports = AlertManager;
