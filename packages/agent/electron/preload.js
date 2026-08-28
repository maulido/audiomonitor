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
  
  // Membaca load % CPU dan RAM
  getHardwareTelemetry: () => ipcRenderer.invoke('get-hardware-telemetry'),
  
  // Mengecek apakah aplikasi diatur untuk menyala otomatis saat komputer hidup
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  
  // Mencentang atau menghapus centang fitur Autostart (Startup)
  setAutostart: (enable) => ipcRenderer.send('set-autostart', enable),
  writeLog: (level, message) => ipcRenderer.send('write-log', { level, message }),
  
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startRecording: (sessionFolderName, partNumber, recordDir) => ipcRenderer.send('start-recording', { sessionFolderName, partNumber, recordDir }),
  saveAudioChunk: (arrayBuffer) => ipcRenderer.send('save-audio-chunk', arrayBuffer),
  stopRecording: (isRollover) => ipcRenderer.send('stop-recording', isRollover)
});
