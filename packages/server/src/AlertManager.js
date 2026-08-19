let TelegramBot = require('node-telegram-bot-api');
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
        console.log('Telegram Bot initialized.');
      } catch (err) {
        console.error('Failed to initialize Telegram Bot:', err);
        this.bot = null;
      }
    } else {
      // Fix 9: Explicitly null the bot when no token
      this.bot = null;
      console.log('No Telegram token found in config. Bot alerts disabled.');
    }
  }

  // Fix 8: Use HTML parse mode to avoid Markdown crashes on underscores
  // Fix 21: No hardcoded prefix — caller provides full message
  sendTelegramAlert(message) {
    const telegramConfig = this.configManager.getTelegramConfig();
    if (this.bot && telegramConfig.chatId) {
      this.bot.sendMessage(telegramConfig.chatId, message, { parse_mode: 'HTML' })
        .catch(err => console.error('Telegram error:', err.message));
    }
  }

  // Helper to escape HTML special characters in dynamic text
  escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  processTelemetry(data, pcName) {
    if (!data || typeof data.status !== 'string') return; // Defensive check

    const isDanger = data.status.startsWith('BAHAYA');
    const safePcName = this.escapeHtml(pcName);
    const safeStatus = this.escapeHtml(data.status.replace(/_/g, ' '));
    
    if (isDanger) {
      const lastAlertTime = this.lastAlertState[data.uuid] || 0;
      const now = Date.now();
      const throttleMs = (this.configManager.getTelegramConfig().interval || 60) * 1000;
      
      if (now - lastAlertTime > throttleMs) {
        this.sendTelegramAlert(
          `[ALERT] <b>AUDIO ISSUE</b>\n<b>${safePcName}</b> mengalami masalah: <b>${safeStatus}</b>`
        );
        if (this.dbManager) this.dbManager.logIncident(data.uuid, pcName, data.status, 'Audio/OBS Issue Detected');
        this.lastAlertState[data.uuid] = now;
      }
    } else if (data.status === 'AMAN' && this.lastAlertState[data.uuid]) {
      this.sendTelegramAlert(`[OK] <b>${safePcName}</b> audio sudah kembali AMAN.`);
      if (this.dbManager) this.dbManager.logIncident(data.uuid, pcName, 'RECOVERY', 'Audio kembali AMAN');
      delete this.lastAlertState[data.uuid];
    } else if (!isDanger && data.status !== 'AMAN' && this.lastAlertState[data.uuid]) {
      // Fix 10: Clear alert state on transitions like BAHAYA -> STANDBY_DIAM
      delete this.lastAlertState[data.uuid];
    }

    // Hardware checks
    if (data.cpuUsage > 85 || data.ramUsage > 85) {
      const hwKey = `${data.uuid}_hw`;
      const lastHwAlertTime = this.lastAlertState[hwKey] || 0;
      const now = Date.now();
      const throttleMs = (this.configManager.getTelegramConfig().interval || 60) * 1000;
      
      if (now - lastHwAlertTime > throttleMs) {
        let issues = [];
        if (data.cpuUsage > 85) issues.push(`CPU (${data.cpuUsage}%)`);
        if (data.ramUsage > 85) issues.push(`RAM (${data.ramUsage}%)`);
        
        let details = `Beban tinggi pada ${issues.join(' & ')}`;
        this.sendTelegramAlert(`[WARN] <b>HARDWARE WARNING</b>\n<b>${safePcName}</b> mengalami ${this.escapeHtml(details)}.`);
        if (this.dbManager) this.dbManager.logIncident(data.uuid, pcName, 'HARDWARE_WARNING', details);
        this.lastAlertState[hwKey] = now;
      }
    } else {
      const hwKey = `${data.uuid}_hw`;
      if (this.lastAlertState[hwKey]) {
        this.sendTelegramAlert(`[OK] <b>${safePcName}</b> hardware sudah kembali stabil.`);
        if (this.dbManager) this.dbManager.logIncident(data.uuid, pcName, 'RECOVERY', 'Hardware kembali stabil');
        delete this.lastAlertState[hwKey];
      }
    }
  }

  processOffline(uuid, pcName) {
    const safePcName = this.escapeHtml(pcName);
    this.sendTelegramAlert(`[OFFLINE] <b>${safePcName}</b> terputus dari jaringan.`);
    if (this.dbManager) this.dbManager.logIncident(uuid, pcName, 'OFFLINE', 'Koneksi terputus');
    delete this.lastAlertState[uuid];
    delete this.lastAlertState[`${uuid}_hw`];
  }
}

module.exports = AlertManager;
