import OBSWebSocket from 'obs-websocket-js';

class OBSClient {
  constructor(onConnect, onDisconnect, onVolumeUpdate) {
    this.obs = new OBSWebSocket();
    this.isConnected = false;
    this.onConnectCallback = onConnect;
    this.onDisconnectCallback = onDisconnect;
    this.onVolumeUpdate = onVolumeUpdate;
    this.reconnectInterval = null;
    this.lastIp = '';
    this.lastPassword = '';
    this.intentionalDisconnect = false;
    
    this.obs.on('ConnectionClosed', () => {
      this.isConnected = false;
      if (this.onDisconnectCallback) this.onDisconnectCallback();
      
      // Auto-reconnect logic
      if (!this.intentionalDisconnect && !this.reconnectInterval) {
        console.log("OBS Connection lost. Attempting auto-reconnect...");
        this.reconnectInterval = setInterval(() => {
          this.connect(this.lastIp, this.lastPassword).catch(() => {});
        }, 5000); // Try to reconnect every 5 seconds
      }
    });

    this.obs.on('InputVolumeMeters', (data) => {
      if (this.onVolumeUpdate && data.inputs) {
        this.onVolumeUpdate(data.inputs);
      }
    });
  }

  async connect(ip, password) {
    this.lastIp = ip;
    this.lastPassword = password;
    this.intentionalDisconnect = false;

    try {
      await this.obs.connect(`ws://${ip}`, password, { 
        rpcVersion: 1,
        eventSubscriptions: 65537 
      });
      this.isConnected = true;
      
      // If we reconnected successfully, clear the interval
      if (this.reconnectInterval) {
        clearInterval(this.reconnectInterval);
        this.reconnectInterval = null;
        console.log("OBS reconnected successfully!");
      }

      if (this.onConnectCallback) this.onConnectCallback();
      return true;
    } catch (error) {
      this.isConnected = false;
      throw error;
    }
  }

  disconnect() {
    this.intentionalDisconnect = true;
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    this.obs.disconnect();
  }
}

export default OBSClient;
