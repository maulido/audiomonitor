import OBSWebSocket from 'obs-websocket-js';

class OBSClient {
  constructor(onConnect, onDisconnect, onVolumeUpdate, onStreamStateChange) {
    this.obs = new OBSWebSocket();
    this.isConnected = false;
    this.onConnectCallback = onConnect;
    this.onDisconnectCallback = onDisconnect;
    this.onVolumeUpdate = onVolumeUpdate;
    this.onStreamStateChange = onStreamStateChange;
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

    this.obs.on('StreamStateChanged', (data) => {
      if (this.onStreamStateChange) {
        this.onStreamStateChange(data.outputActive);
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
        eventSubscriptions: 65601 
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

  async getAudioInputs() {
    if (!this.isConnected) return [];
    try {
      // Fetch all inputs from OBS
      const response = await this.obs.call('GetInputList');
      return response.inputs;
    } catch (error) {
      console.error("Failed to fetch OBS inputs:", error);
      return [];
    }
  }

  async getStreamStatus() {
    if (!this.isConnected) return { outputActive: false };
    try {
      const response = await this.obs.call('GetStreamStatus');
      return response;
    } catch (error) {
      console.error("Failed to fetch OBS stream status:", error);
      return { outputActive: false };
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
