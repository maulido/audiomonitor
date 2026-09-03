const { contextBridge, ipcRenderer } = require('electron');

/**
 * contextBridge berfungsi sebagai lapisan keamanan (Context Isolation).
 * Menjembatani fungsi dari backend (main.js / NodeJS) agar bisa diakses dengan aman
 * dari antarmuka frontend (React / App.jsx) tanpa memberikan akses penuh ke sistem operasi.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // Mengambil atau membuat ID unik untuk Agen ini
  getUUID: () => ipcRenderer.invoke('get-uuid'),
  
  // Menampilkan notifikasi popup native Windows
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  closeNotification: () => ipcRenderer.send('close-notification'),
  
  // Membaca load % CPU dan RAM
  getHardwareTelemetry: () => ipcRenderer.invoke('get-hardware-telemetry'),
  
  // Mengecek apakah aplikasi diatur untuk menyala otomatis saat komputer hidup
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  
  // Mencentang atau menghapus centang fitur Autostart (Startup)
  setAutostart: (enable) => ipcRenderer.invoke('set-autostart', enable),
  writeLog: (level, message) => ipcRenderer.send('write-log', { level, message }),
  openLogsFolder: () => ipcRenderer.send('open-logs-folder'),
  
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getStorageInfo: (recordDir) => ipcRenderer.invoke('get-storage-info', recordDir),
  deleteLocalRecordings: (options) => ipcRenderer.invoke('delete-local-recordings', options),
  openRecordingsFolder: (recordDir) => ipcRenderer.invoke('open-recordings-folder', recordDir),
  startRecording: (sessionFolderName, partNumber, recordDir, agentName, serverIp) => ipcRenderer.send('start-recording', { sessionFolderName, partNumber, recordDir, agentName, serverIp }),
  stopRecording: (isRollover) => ipcRenderer.send('stop-recording', isRollover),
  saveAudioChunk: (arrayBuffer) => ipcRenderer.send('save-audio-chunk', arrayBuffer),
  getWindowsAudioDevices: () => ipcRenderer.invoke('get-windows-audio-devices'),
  getObsGlobalDevice: (collectionName, deviceKey) => ipcRenderer.invoke('get-obs-global-device', { collectionName, deviceKey }),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', { width, height }),
  installUpdate: (downloadUrl) => ipcRenderer.invoke('install-update', downloadUrl),
  onUpdateProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('update-progress', handler);
    return () => ipcRenderer.removeListener('update-progress', handler);
  }
});
