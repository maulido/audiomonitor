const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor(configFilePath = 'config.json') {
    this.configPath = path.resolve(__dirname, '../', configFilePath);
    this.config = { pcMapping: {}, telegram: { token: '', chatId: '' } };
    this.loadConfig();
  }

  loadConfig() {
    if (fs.existsSync(this.configPath)) {
      try {
        const fileContent = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(fileContent);
      } catch (err) {
        console.error('Error reading config file:', err);
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
    return this.config.pcMapping[uuid] || uuid;
  }

  setPcName(uuid, name) {
    this.config.pcMapping[uuid] = name;
    this.saveConfig();
  }

  getAllPcMappings() {
    return this.config.pcMapping;
  }

  getTelegramConfig() {
    return this.config.telegram;
  }
}

module.exports = ConfigManager;
