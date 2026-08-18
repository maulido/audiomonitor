import { io } from 'socket.io-client';

class TelemetryClient {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.socket = null;
    this.lastSendTime = 0;
    this.THROTTLE_MS = 100; // Max 10 updates per second
  }

  connect() {
    if (!this.socket) {
      this.socket = io(this.serverUrl);
      this.socket.on('set-monitoring', (active) => {
        if (this.onSetMonitoring) this.onSetMonitoring(active);
      });
      // Register this socket to a specific agent room so server can address it
      this.socket.on('connect', () => {
        if (this.agentUuid) {
          this.socket.emit('register', { type: 'agent', uuid: this.agentUuid });
        }
      });
    }
  }

  setRenameListener(callback) {
    if (!this.socket) return;
    this.socket.on('command-rename', callback);
  }

  setMonitoringListener(uuid, callback) {
    this.agentUuid = uuid;
    this.onSetMonitoring = callback;
    if (this.socket && this.socket.connected) {
      this.socket.emit('register', { type: 'agent', uuid: this.agentUuid });
    }
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
