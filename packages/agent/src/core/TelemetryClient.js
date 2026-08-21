import { io } from 'socket.io-client';

/**
 * Class TelemetryClient
 * Mengatur koneksi WebSocket dua-arah antara PC Agent dan Server Pusat (Dashboard).
 * Berfungsi untuk mengirimkan data secara real-time dan mendengarkan perintah (seperti ubah nama atau setelan).
 */
class TelemetryClient {
  /**
   * Menginisialisasi koneksi client.
   * @param {string} serverUrl - Alamat IP dan Port dari Server Pusat.
   */
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.socket = null;
    this.lastSendTime = 0;
    
    // Membatasi pengiriman data maksimal 10 kali per detik agar tidak membebani jaringan
    this.THROTTLE_MS = 100; 
  }

  /**
   * Membuka koneksi WebSocket ke Server.
   * Akan mendaftarkan socket ini ke dalam 'room' khusus berdasarkan UUID Agent-nya
   * supaya server bisa mengirimkan perintah spesifik ke PC ini.
   */
  connect() {
    if (!this.socket) {
      this.socket = io(this.serverUrl);
      
      // Menerima perintah untuk mengaktifkan/menonaktifkan pemantauan
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

  /**
   * Mendaftarkan fungsi callback untuk menangani perintah 'Rename' (Ubah Nama PC) dari Dashboard.
   * @param {Function} callback - Fungsi yang dipanggil saat ada perintah ubah nama.
   */
  setRenameListener(callback) {
    if (!this.socket) return;
    this.socket.on('command-rename', callback);
  }

  /**
   * Mendaftarkan fungsi callback untuk menangani perintah 'Remote Config' (Sinkronisasi Setelan) dari Dashboard.
   * @param {Function} callback - Fungsi yang dipanggil dengan payload setelan baru.
   */
  setConfigUpdateListener(callback) {
    if (!this.socket) return;
    this.socket.on('update-config', callback);
  }

  /**
   * Mengaitkan UUID unik PC ini dan mendaftarkan listener untuk status pemantauan (ON/OFF).
   * @param {string} uuid - ID unik dari Agent PC.
   * @param {Function} callback - Fungsi yang dipanggil untuk mengubah status monitoring di UI.
   */
  setMonitoringListener(uuid, callback) {
    this.agentUuid = uuid;
    this.onSetMonitoring = callback;
    if (this.socket && this.socket.connected) {
      this.socket.emit('register', { type: 'agent', uuid: this.agentUuid });
    }
  }

  /**
   * Menutup paksa koneksi WebSocket dan membersihkan timer yang tertunda.
   */
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

  /**
   * Mengirimkan paket data (telemetri) ke Server Pusat.
   * Dilengkapi dengan mekanisme Throttling (membatasi frekuensi pengiriman)
   * agar bandwidth jaringan lokal tidak habis jika ada terlalu banyak pembaruan beruntun.
   * @param {Object} data - Objek berisi seluruh status Agent (Audio, OBS, Hardware, dll).
   */
  sendTelemetry(data) {
    if (this.socket && this.socket.connected) {
      const now = Date.now();
      
      // Jika waktu sejak pengiriman terakhir kurang dari batas Throttle (100ms)
      if (now - this.lastSendTime < this.THROTTLE_MS) {
        this.pendingData = data;
        
        // Buat antrean pengiriman tertunda
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

      // Jika sudah melewati batas Throttle, kirim langsung
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
