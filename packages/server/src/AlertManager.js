const TelegramBot = require('node-telegram-bot-api');

class AlertManager {
  constructor(configManager, dbManager) {
    this.configManager = configManager;
    this.dbManager = dbManager;
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
    const isDanger = data.status.startsWith('BAHAYA');
    
    if (isDanger) {
      const lastAlertTime = this.lastAlertState[data.uuid] || 0;
      const now = Date.now();
      
      // Send alert if it's the first time or enough time has passed
      if (now - lastAlertTime > this.THROTTLE_MS) {
        let msg = `*${pcName}* mengalami masalah: *${data.status.replace(/_/g, ' ')}*`;
        this.sendTelegramAlert(msg);
        if (this.dbManager) this.dbManager.logIncident(data.uuid, pcName, data.status, 'Audio/OBS Issue Detected');
        this.lastAlertState[data.uuid] = now;
      }
    } else if (data.status === 'AMAN' && this.lastAlertState[data.uuid]) {
      // It recovered
      this.sendTelegramAlert(`✅ *${pcName}* audio sudah kembali AMAN.`);
      if (this.dbManager) this.dbManager.logIncident(data.uuid, pcName, 'RECOVERY', 'Audio kembali AMAN');
      delete this.lastAlertState[data.uuid];
    }

    // Hardware checks
    if (data.cpuUsage > 85 || data.ramUsage > 85) {
      const hwKey = `${data.uuid}_hw`;
      const lastHwAlertTime = this.lastAlertState[hwKey] || 0;
      const now = Date.now();
      
      if (now - lastHwAlertTime > this.THROTTLE_MS) {
        let issues = [];
        if (data.cpuUsage > 85) issues.push(`CPU (${data.cpuUsage}%)`);
        if (data.ramUsage > 85) issues.push(`RAM (${data.ramUsage}%)`);
        
        let details = `Beban tinggi pada ${issues.join(' & ')}`;
        this.sendTelegramAlert(`🔥 *HARDWARE WARNING*\n*${pcName}* mengalami ${details}.`);
        if (this.dbManager) this.dbManager.logIncident(data.uuid, pcName, 'HARDWARE_WARNING', details);
        this.lastAlertState[hwKey] = now;
      }
    } else {
      const hwKey = `${data.uuid}_hw`;
      if (this.lastAlertState[hwKey]) {
        this.sendTelegramAlert(`✅ *${pcName}* hardware sudah kembali stabil.`);
        if (this.dbManager) this.dbManager.logIncident(data.uuid, pcName, 'RECOVERY', 'Hardware kembali stabil');
        delete this.lastAlertState[hwKey];
      }
    }
  }

  processOffline(uuid, pcName) {
    this.sendTelegramAlert(`🔌 *${pcName}* terputus dari jaringan (OFFLINE).`);
    if (this.dbManager) this.dbManager.logIncident(uuid, pcName, 'OFFLINE', 'Koneksi terputus');
    // Reset alert state so it can alert again when it reconnects and fails
    delete this.lastAlertState[uuid];
    delete this.lastAlertState[`${uuid}_hw`];
  }
}

module.exports = AlertManager;
