import { io } from 'socket.io-client';

class TelemetryClient {
  constructor(serverUrl, agentUuid = null, agentName = null) {
    this.serverUrl = serverUrl;
    this.agentUuid = agentUuid;
    this.agentName = agentName;
    this.socket = null;
    this.lastSendTime = 0;
    this.THROTTLE_MS = 100;
  }

  setAgentName(name) {
    this.agentName = name;
  }

  connect() {
    if (!this.socket) {
      this.socket = io(this.serverUrl);
      
      this.socket.on('set-monitoring', (active) => {
        if (this.onSetMonitoring) this.onSetMonitoring(active);
      });
      
      this.socket.on('monitoring-status', (active) => {
        if (this.onGlobalMonitoring) this.onGlobalMonitoring(active);
      });

      this.socket.on('connect', () => {
        if (this.agentUuid) {
          this.socket.emit('register', { type: 'agent', uuid: this.agentUuid, name: this.agentName });
        }
      });

      // Menangani berbagai perintah tunggal dari Server Pusat
      this.socket.on('command-record', (payload) => {
        if (this.onRecordListener) this.onRecordListener(payload);
      });
      
      this.socket.on('command-rename', (payload) => {
        if (this.onRenameListener) this.onRenameListener(payload);
      });
      
      this.socket.on('update-config', (payload) => {
        if (this.onConfigUpdateListener) this.onConfigUpdateListener(payload);
      });
      
      // Menerima pengaturan Telegram dari Server untuk fallback saat Agent offline
      this.socket.on('telegram-config', (config) => {
        if (this.onTelegramConfigListener) this.onTelegramConfigListener(config);
      });

      // Menerima PIN keamanan dari Server Pusat
      this.socket.on('server-pin', (data) => {
        if (this.onServerPinListener) this.onServerPinListener(data);
      });
    }
  }

  setServerPinListener(callback) {
    this.onServerPinListener = callback;
  }

  setRecordListener(callback) {
    this.onRecordListener = callback;
  }

  setTelegramConfigListener(callback) {
    this.onTelegramConfigListener = callback;
  }

  setRenameListener(callback) {
    this.onRenameListener = callback;
  }

  setConfigUpdateListener(callback) {
    this.onConfigUpdateListener = callback;
  }

  setMonitoringListener(uuid, callback) {
    this.agentUuid = uuid;
    this.onSetMonitoring = callback;
    if (this.socket && this.socket.connected) {
      this.socket.emit('register', { type: 'agent', uuid: this.agentUuid });
    }
  }

  setGlobalMonitoringListener(callback) {
    this.onGlobalMonitoring = callback;
  }

  disconnect() {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  sendTelemetry(data) {
    if (this.socket && this.socket.connected) {
      const now = Date.now();
      if (now - this.lastSendTime < this.THROTTLE_MS) {
        this.pendingData = data;
        if (!this.throttleTimer) {
          this.throttleTimer = setTimeout(() => {
            if (this.pendingData && this.socket && this.socket.connected) {
              this.socket.emit('telemetry', this.pendingData);
              this.lastSendTime = Date.now();
              this.pendingData = null;
            }
            this.throttleTimer = null;
          }, this.THROTTLE_MS - (now - this.lastSendTime));
        }
        return;
      }

      if (this.throttleTimer) {
        clearTimeout(this.throttleTimer);
        this.throttleTimer = null;
      }
      this.socket.emit('telemetry', data);
      this.lastSendTime = now;
      this.pendingData = null;
    }
  }
}

export default TelemetryClient;
