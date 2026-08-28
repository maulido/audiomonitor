import OBSWebSocket from 'obs-websocket-js';

/**
 * Class OBSClient
 * Menangani seluruh interaksi dan koneksi WebSocket antara aplikasi Agent dan aplikasi OBS Studio.
 */
class OBSClient {
  /**
   * Menginisialisasi klien OBS.
   * @param {Function} onConnect - Callback ketika berhasil terkoneksi ke OBS.
   * @param {Function} onDisconnect - Callback ketika koneksi ke OBS terputus.
   * @param {Function} onVolumeUpdate - Callback yang dipanggil saat ada data perubahan volume meter dari OBS.
   * @param {Function} onStreamStateChange - Callback yang dipanggil ketika status streaming OBS berubah (LIVE/OFF).
   */
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

  /**
   * Fungsi internal untuk mengikat (binding) event-event dari library obs-websocket-js ke callback milik kelas ini.
   * Menangani event pemutusan koneksi (termasuk auto-reconnect), pembaruan meteran audio, dan status stream.
   * @private
   */
  _bindEvents() {
    if (!this.obs) return;
    
    // Dipanggil saat koneksi OBS tertutup
    this.obs.on('ConnectionClosed', () => {
      this.isConnected = false;
      if (this.onDisconnectCallback) this.onDisconnectCallback();
      
      // Auto-reconnect logic: Jika putus bukan karena tombol Disconnect manual, coba hubungkan ulang setiap 5 detik.
      if (!this.intentionalDisconnect && !this.reconnectInterval) {
        console.log("OBS Connection lost. Attempting auto-reconnect...");
        this.reconnectInterval = setInterval(() => {
          this.connect(this.lastIp, this.lastPassword, true).catch(() => {});
        }, 5000);
      }
    });

    // Menangkap pergerakan bar hijau (Volume Meter) dari dalam OBS
    this.obs.on('InputVolumeMeters', (data) => {
      if (this.onVolumeUpdate && data.inputs) {
        this.onVolumeUpdate(data.inputs);
      }
    });

    // Menangkap perubahan status tombol Start/Stop Streaming
    this.obs.on('StreamStateChanged', (data) => {
      if (this.onStreamStateChange) {
        this.onStreamStateChange(data.outputActive);
      }
    });

    // Menangkap pergantian scene
    this.obs.on('CurrentProgramSceneChanged', (data) => {
      if (this.onSceneChange) {
        this.onSceneChange(data.sceneName);
      }
    });
    // Menangkap perubahan status Mute
    this.obs.on('InputMuteStateChanged', (data) => {
      if (this.onMuteStateChange) {
        this.onMuteStateChange(data.inputName, data.inputMuted);
      }
    });
  }

  /**
   * Menghubungkan ke server WebSocket OBS Studio.
   * @param {string} ip - Alamat IP:Port WebSocket OBS (contoh: 127.0.0.1:4455).
   * @param {string} password - Kata sandi otentikasi WebSocket OBS.
   * @param {boolean} isAutoReconnect - Flag internal untuk menandai apakah koneksi ini merupakan proses penyambungan ulang otomatis.
   * @returns {Promise<boolean>} Resolves jika berhasil terhubung, Reject jika gagal.
   */
  async connect(ip, password, isAutoReconnect = false) {
    if (this.isConnecting) return false;
    
    // Cegah koneksi ganda jika sudah terhubung ke tujuan yang sama
    if (!isAutoReconnect && this.isConnected && this.lastIp === ip && this.lastPassword === password && this.obs) {
      if (this.onConnectCallback) this.onConnectCallback();
      return true;
    }
    
    this.isConnecting = true;

    // Bersihkan interval koneksi ulang otomatis yang lama
    if (!isAutoReconnect && this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }

    // Hancurkan instansi OBS yang lama secara total untuk mencegah 'koneksi zombie'
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

    // Buat instansi OBS WebSocket baru
    this.obs = new OBSWebSocket();
    this._bindEvents();

    try {
      // eventSubscriptions 65601 mengaktifkan langganan event khusus (contoh: InputVolumeMeters)
      await this.obs.connect(`ws://${ip}`, password, { 
        rpcVersion: 1,
        eventSubscriptions: 65601 
      });
      
      this.isConnected = true;
      this.isConnecting = false;
      
      // Matikan interval auto-reconnect karena kita sudah berhasil masuk
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

  /**
   * Mengambil daftar seluruh sumber Audio (Input List) yang saat ini ada di OBS.
   * @returns {Promise<Array>} Array berisi detail setiap Input Audio (contoh: inputName, inputKind).
   */
  async getAudioInputs() {
    if (!this.isConnected || !this.obs) return [];
    try {
      const response = await this.obs.call('GetInputList');
      return response.inputs || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Mengecek status siaran (Streaming) secara instan.
   * Berbeda dengan event listener, ini secara aktif memanggil API ke OBS untuk menanyakan status.
   * @returns {Promise<Object>} Mengembalikan objek berisi status { outputActive: boolean } dan waktu siaran jika sedang aktif.
   */
  async getStreamStatus() {
    if (!this.isConnected || !this.obs) return { outputActive: false };
    try {
      const response = await this.obs.call('GetStreamStatus');
      return response;
    } catch (error) {
      return { outputActive: false };
    }
  }

  /**
   * Mengambil detail komprehensif untuk SEMUA sumber (Sources) audio.
   * Untuk setiap sumber, fungsi ini juga memanggil API ekstra untuk mendapatkan Mute Status, Volume DB, dan Monitor Type.
   * Fungsi ini memakan waktu dan sumber daya (multiple RPC calls) sehingga cocok dipanggil sekali di awal untuk membangun state UI.
   * @returns {Promise<Array>} Array berisi objek sumber audio yang lengkap dengan status mute dan db.
   */
  
  
  async setMute(inputName, muted) {
    if (!this.obs) return;
    try {
      await this.obs.call('SetInputMute', { inputName, inputMuted: muted });
      console.log(`[OBS] ${muted ? 'Muted' : 'Unmuted'} ${inputName}`);
    } catch (err) {
      console.error('[OBS] Failed to set mute:', err.message);
    }
  }

  async getWindowsAudioDevices() {
    if (process.platform !== 'win32') return {};
    try {
      if (window.electronAPI && window.electronAPI.getWindowsAudioDevices) {
        return await window.electronAPI.getWindowsAudioDevices();
      }
      return {};
    } catch (err) {
      console.error("Failed to map audio devices:", err);
      return {};
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
          
                    let hardwareId = 'Unknown';
            try {
              const setRes = await this.obs.call('GetInputSettings', { inputName: input.inputName });
              let rawId = setRes.inputSettings.device_id || setRes.inputSettings.device || 'Default';
              const matches = rawId.match(/\{[a-fA-F0-9\-]+\}/g);
                if (matches && matches.length > 0) {
                  const guid = matches[matches.length - 1].toLowerCase();
                if (!this._deviceMapping) {
                  this._deviceMapping = await this.getWindowsAudioDevices();
                }
                if (this._deviceMapping[guid]) {
                  rawId = this._deviceMapping[guid];
                }
              }
              hardwareId = rawId;
            } catch (err) {
              // Fallback for global audio devices
              try {
                let paramName = null;
                if (input.inputName === 'Mic/Aux') paramName = 'Mic1';
                else if (input.inputName === 'Mic/Aux 2') paramName = 'Mic2';
                else if (input.inputName === 'Mic/Aux 3') paramName = 'Mic3';
                else if (input.inputName === 'Mic/Aux 4') paramName = 'Mic4';
                else if (input.inputName === 'Desktop Audio') paramName = 'Desktop1';
                else if (input.inputName === 'Desktop Audio 2') paramName = 'Desktop2';
                
                if (paramName) {
                  const profRes = await this.obs.call('GetProfileParameter', { parameterCategory: 'Audio', parameterName: paramName });
                  let rawId = profRes.parameterValue || 'Default';
                  const matches = rawId.match(/\{[a-fA-F0-9\-]+\}/g);
                  if (matches && matches.length > 0) {
                    const guid = matches[matches.length - 1].toLowerCase();
                    if (!this._deviceMapping) {
                      this._deviceMapping = await this.getWindowsAudioDevices();
                    }
                    if (this._deviceMapping[guid]) {
                      rawId = this._deviceMapping[guid];
                    }
                  }
                  hardwareId = rawId;
                }
              } catch (e) {
                console.error("Failed GetProfileParameter for", input.inputName, e);
              }
            }
          
          detailed.push({
            name: input.inputName,
            muted: muteRes.inputMuted,
            db: parseFloat((volRes.inputVolumeDb).toFixed(1)),
            volume: volRes.inputVolumeMul,
            monitorType: monRes.monitorType,
            hardwareId: hardwareId
          });
        } catch (e) {}
      }
      return detailed;
    } catch (error) {
      console.error("Failed to get detailed sources", error);
      return [];
    }
  }

  /**
   * Memutus koneksi OBS secara manual.
   * Berbeda dengan pemutusan tak sengaja, ini mematikan bendera auto-reconnect.
   */
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
