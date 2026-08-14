import OBSWebSocket from 'obs-websocket-js';

class OBSClient {
  constructor(onConnect, onDisconnect, onVolumeUpdate) {
    this.obs = new OBSWebSocket();
    this.isConnected = false;
    this.onConnectCallback = onConnect;
    this.onDisconnectCallback = onDisconnect;
    this.onVolumeUpdate = onVolumeUpdate;
    
    this.obs.on('ConnectionClosed', () => {
      this.isConnected = false;
      if (this.onDisconnectCallback) this.onDisconnectCallback();
    });

    this.obs.on('InputVolumeMeters', (data) => {
      if (this.onVolumeUpdate && data.inputs) {
        this.onVolumeUpdate(data.inputs);
      }
    });
  }

  async connect(ip, password) {
    try {
      // 65536 is the bitmask for InputVolumeMeters (1 << 16).
      // We also want standard events which is usually (1 << 0) = 1.
      // So 65536 | 1 = 65537
      await this.obs.connect(`ws://${ip}`, password, { 
        rpcVersion: 1,
        eventSubscriptions: 65537 
      });
      this.isConnected = true;
      if (this.onConnectCallback) this.onConnectCallback();
      return true;
    } catch (error) {
      console.error('Failed to connect to OBS', error);
      this.isConnected = false;
      throw error;
    }
  }

  disconnect() {
    this.obs.disconnect();
  }
}

export default OBSClient;
