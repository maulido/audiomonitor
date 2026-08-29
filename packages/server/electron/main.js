const { app, Menu, Tray, shell, dialog } = require('electron');
const path = require('path');
const ServerApp = require('../src/ServerApp');

let tray = null;
let serverApp = null;
const port = 4000;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    shell.openExternal(`http://localhost:${port}`);
  });

  app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  
  serverApp = new ServerApp(port);
  serverApp.start((err) => {
    if (err.code === 'EADDRINUSE') {
      dialog.showErrorBox('Port 4000 Terpakai', 'Server gagal berjalan karena Port 4000 sudah digunakan. Apakah ada Server lain yang masih terbuka?');
    } else {
      dialog.showErrorBox('Server Error', `Server gagal berjalan: ${err.message || err.code}`);
    }
    app.quit();
  });

  const iconPath = path.join(__dirname, '../public/icon.ico');
  tray = new Tray(iconPath);

  const updateMenu = () => {
    const AutoLaunch = require('auto-launch');
    const serverAutoLauncher = new AutoLaunch({
      name: 'AudioMonitor_Server',
      path: app.getPath('exe'),
    });

    serverAutoLauncher.isEnabled().then((isEnabled) => {
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Audio Monitor Server', enabled: false },
        { label: `Status: Running (Port ${port})`, enabled: false },
        { type: 'separator' },
        { 
          label: 'Buka Dashboard', 
          click: () => shell.openExternal(`http://localhost:${port}`)
        },
        { type: 'separator' },
        {
          label: 'Ubah Lokasi Penyimpanan Audio',
          click: () => {
             const result = dialog.showOpenDialogSync({
               title: 'Pilih Folder Penyimpanan Rekaman (Server)',
               properties: ['openDirectory']
             });
             if (result && result.length > 0) {
               serverApp.configManager.config.recordDir = result[0];
               serverApp.configManager.saveConfig();
               dialog.showMessageBoxSync({ type: 'info', title: 'Berhasil', message: `Lokasi penyimpanan server berhasil diubah ke:\n${result[0]}` });
             }
          }
        },
        { type: 'separator' },
        {
          label: isEnabled ? 'Matikan Auto-Start' : 'Hidupkan Auto-Start',
          click: () => {
            const action = isEnabled ? serverAutoLauncher.disable() : serverAutoLauncher.enable();
            Promise.resolve(action).finally(() => setTimeout(updateMenu, 500));
          }
        },
        { type: 'separator' },
        { label: 'Restart Server', click: () => { app.relaunch(); app.exit(0); } },
        { label: 'Keluar', click: () => app.quit() }
      ]);
      tray.setToolTip('Audio Monitor Server');
      tray.setContextMenu(contextMenu);
    }).catch(console.error);
  };

  updateMenu();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
}
