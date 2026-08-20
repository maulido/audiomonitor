import OBSWebSocket from 'obs-websocket-js';

class OBSClient {
  constructor(onConnect, onDisconnect, onVolumeUpdate, onStreamStateChange) {
    this.obs = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.onConnectCallback = onConnect;
    this.onDisconnectCallback = onDisconnect;
    this.onVolumeUpdate = onVolumeUpdate;
    this.onStreamStateChange = onStreamStateChange;
    this.reconnectInterval = null;
    this.lastIp = '';
    this.lastPassword = '';
    this.intentionalDisconnect = false;
  }

  _bindEvents() {
    if (!this.obs) return;
    
    this.obs.on('ConnectionClosed', () => {
      this.isConnected = false;
      if (this.onDisconnectCallback) this.onDisconnectCallback();
      
      // Auto-reconnect logic
      if (!this.intentionalDisconnect && !this.reconnectInterval) {
        console.log("OBS Connection lost. Attempting auto-reconnect...");
        this.reconnectInterval = setInterval(() => {
          this.connect(this.lastIp, this.lastPassword, true).catch(() => {});
        }, 5000);
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

  async connect(ip, password, isAutoReconnect = false) {
    if (this.isConnecting) return false;
    
    // Prevent duplicate connections if already connected to the same destination
    if (!isAutoReconnect && this.isConnected && this.lastIp === ip && this.lastPassword === password && this.obs) {
      if (this.onConnectCallback) this.onConnectCallback();
      return true;
    }
    
    this.isConnecting = true;

    if (!isAutoReconnect && this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }

    // Completely destroy old instance to avoid zombie connections
    if (this.obs) {
      try {
        this.obs.removeAllListeners();
        await this.obs.disconnect();
      } catch(e) {}
      this.obs = null;
    }

    this.lastIp = ip;
    this.lastPassword = password;
    this.intentionalDisconnect = false;

    // Create fresh instance
    this.obs = new OBSWebSocket();
    this._bindEvents();

    try {
      await this.obs.connect(`ws://${ip}`, password, { 
        rpcVersion: 1,
        eventSubscriptions: 65601 
      });
      this.isConnected = true;
      this.isConnecting = false;
      
      if (this.reconnectInterval) {
        clearInterval(this.reconnectInterval);
        this.reconnectInterval = null;
      }
      
      if (this.onConnectCallback) this.onConnectCallback();
      return true;
    } catch (error) {
      this.isConnected = false;
      this.isConnecting = false;
      if (this.obs) {
        this.obs.removeAllListeners();
        try { this.obs.disconnect(); } catch(e) {}
        this.obs = null;
      }
      throw error;
    }
  }

  async getAudioInputs() {
    if (!this.isConnected || !this.obs) return [];
    try {
      const response = await this.obs.call('GetInputList');
      return response.inputs || [];
    } catch (error) {
      return [];
    }
  }

  async getStreamStatus() {
    if (!this.isConnected || !this.obs) return { outputActive: false };
    try {
      const response = await this.obs.call('GetStreamStatus');
      return response;
    } catch (error) {
      return { outputActive: false };
    }
  }

  async getDetailedSources() {
    if (!this.isConnected || !this.obs) return [];
    try {
      const response = await this.obs.call('GetInputList');
      const inputs = response.inputs || [];
      const detailed = [];
      
      for (const input of inputs) {
        try {
          const muteRes = await this.obs.call('GetInputMute', { inputName: input.inputName });
          const volRes = await this.obs.call('GetInputVolume', { inputName: input.inputName });
          const monRes = await this.obs.call('GetInputAudioMonitorType', { inputName: input.inputName });
          
          detailed.push({
            name: input.inputName,
            muted: muteRes.inputMuted,
            db: parseFloat((volRes.inputVolumeDb).toFixed(1)),
            volume: volRes.inputVolumeMul,
            monitorType: monRes.monitorType
          });
        } catch (e) {}
      }
      return detailed;
    } catch (e) {
      return [];
    }
  }

  disconnect() {
    this.intentionalDisconnect = true;
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    if (this.obs) {
      this.obs.removeAllListeners();
      try { this.obs.disconnect(); } catch(e) {}
      this.obs = null;
    }
    this.isConnected = false;
  }
}

export default OBSClient;
