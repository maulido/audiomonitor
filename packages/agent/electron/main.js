const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const isDev = process.env.NODE_ENV === 'development';
const configPath = path.join(app.getPath('userData'), 'config.json');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Ensure unique ID exists
function getOrCreateUUID() {
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.uuid) return config.uuid;
  }
  
  const newUuid = crypto.randomUUID();
  fs.writeFileSync(configPath, JSON.stringify({ uuid: newUuid }, null, 2));
  return newUuid;
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const { x: workAreaX, y: workAreaY } = primaryDisplay.workArea;

  const windowWidth = 450;
  const windowHeight = 600;

  // Calculate bottom right corner with 15px padding
  const x = workAreaX + screenWidth - windowWidth - 15;
  const y = workAreaY + screenHeight - windowHeight - 15;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: x,
    y: y,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Prevent window from closing, minimize to tray instead
  mainWindow.on('close', function (event) {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });
}

function createTray() {
  // Use a robust .ico file for Windows system tray
  let iconPath = path.join(__dirname, '../public/icon.ico');
  if (!isDev) {
    iconPath = path.join(__dirname, '../dist/icon.ico');
  }
  
  try {
    tray = new Tray(iconPath);
  } catch (e) {
    console.error('Tray icon error:', e);
    tray = new Tray(nativeImage.createEmpty());
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => mainWindow.show() },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: () => {
        isQuitting = true;
        app.quit();
      } 
    }
  ]);
  
  tray.setToolTip('Audio Monitor Agent');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

// IPC Handlers
ipcMain.handle('get-uuid', () => {
  return getOrCreateUUID();
});

let previousCpus = require('os').cpus();

ipcMain.handle('get-hardware-telemetry', () => {
  const os = require('os');
  const free = os.freemem();
  const total = os.totalmem();
  const ramUsage = Math.round(((total - free) / total) * 100);
  
  const cpus = os.cpus();
  let totalDelta = 0;
  let idleDelta = 0;

  for (let i = 0; i < cpus.length; i++) {
    const cpu = cpus[i];
    const prevCpu = previousCpus[i] || cpu;

    let cpuTotal = 0;
    for (let type in cpu.times) cpuTotal += cpu.times[type];
    
    let prevTotal = 0;
    for (let type in prevCpu.times) prevTotal += prevCpu.times[type];

    totalDelta += (cpuTotal - prevTotal);
    idleDelta += (cpu.times.idle - prevCpu.times.idle);
  }

  const cpuUsage = totalDelta === 0 ? 0 : Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
  previousCpus = cpus;
  
  return {
    ramUsage,
    cpuUsage
  };
});

ipcMain.on('show-notification', (event, { title, body }) => {
  new Notification({ title, body }).show();
});
