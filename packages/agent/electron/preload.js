const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getUUID: () => ipcRenderer.invoke('get-uuid'),
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  getHardwareTelemetry: () => ipcRenderer.invoke('get-hardware-telemetry'),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enable) => ipcRenderer.send('set-autostart', enable)
});
