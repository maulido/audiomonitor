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
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  sendTelemetry(data) {
    if (this.socket && this.socket.connected) {
      const now = Date.now();
      if (now - this.lastSendTime > this.THROTTLE_MS) {
        this.socket.emit('telemetry', data);
        this.lastSendTime = now;
      }
    }
  }
}

export default TelemetryClient;
