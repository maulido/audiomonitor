const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor(configFilePath = 'config.json') {
    this.configPath = path.resolve(__dirname, '../', configFilePath);
    this.defaultConfig = {
      pcMapping: {},
      telegram: { token: '', chatId: '' },
      monitoringActive: true,
      dashboardPin: '1234'
    };
    this.config = { ...this.defaultConfig };
    this.loadConfig();
  }

  loadConfig() {
    if (fs.existsSync(this.configPath)) {
      try {
        const fileContent = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(fileContent);
        // Fix 7: Deep merge with defaults to prevent missing key crashes
        this.config = {
          pcMapping: parsed.pcMapping || {},
          telegram: {
            token: '',
            chatId: '',
            ...(parsed.telegram || {})
          },
          monitoringActive: parsed.monitoringActive !== undefined ? parsed.monitoringActive : true,
          dashboardPin: parsed.dashboardPin || '1234'
        };
      } catch (err) {
        console.error('Error reading config file, using defaults:', err.message);
        this.config = { ...this.defaultConfig, telegram: { ...this.defaultConfig.telegram } };
        this.saveConfig();
      }
    } else {
      this.saveConfig();
    }
  }

  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error('Error saving config file:', err);
    }
  }

  getPcName(uuid) {
    return (this.config.pcMapping && this.config.pcMapping[uuid]) || uuid;
  }

  setPcName(uuid, name) {
    if (!this.config.pcMapping) this.config.pcMapping = {};
    this.config.pcMapping[uuid] = name;
    this.saveConfig();
  }

  getAllPcMappings() {
    return this.config.pcMapping || {};
  }

  getTelegramConfig() {
    return this.config.telegram || { token: '', chatId: '' };
  }
}

module.exports = ConfigManager;
