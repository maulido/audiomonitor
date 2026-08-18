const { app, Menu, Tray, shell, dialog } = require('electron');
const path = require('path');
const ServerApp = require('../src/ServerApp');

let tray = null;
let serverApp = null;
const port = 4000;

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  
  serverApp = new ServerApp(port);
  serverApp.start((err) => {
    if (err.code === 'EADDRINUSE') {
      dialog.showErrorBox('Port 4000 Terpakai', 'Server gagal berjalan karena Port 4000 sudah digunakan. Apakah ada Server lain yang masih terbuka?');
      app.quit();
    }
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
          label: isEnabled ? 'Matikan Auto-Start' : 'Hidupkan Auto-Start',
          click: () => {
            if (isEnabled) serverAutoLauncher.disable();
            else serverAutoLauncher.enable();
            setTimeout(updateMenu, 500);
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
