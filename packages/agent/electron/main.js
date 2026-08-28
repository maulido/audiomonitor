const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, screen, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// --- AGENT LOGGER ---
const logsDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logsDir)) { fs.mkdirSync(logsDir, { recursive: true }); }

function getLogFile() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return path.join(logsDir, `agent-${yyyy}-${mm}-${dd}.log`);
}

function writeAgentLog(level, message) {
  const now = new Date();
  const timeString = now.toTimeString().split(' ')[0];
  const line = `[${timeString}] [${level}] ${message}\n`;
  try { fs.appendFileSync(getLogFile(), line); } catch(e) {}
}
// --------------------

const isDev = process.env.NODE_ENV === 'development';
const configPath = path.join(app.getPath('userData'), 'config.json');

let mainWindow = null;
let tray = null;
let isQuitting = false;

/**
 * Fungsi ini bertugas membaca UUID dari file konfigurasi lokal.
 * Jika file atau UUID tidak ditemukan, maka akan membuat UUID acak baru
 * dan menyimpannya ke dalam file tersebut agar perangkat ini dikenali secara permanen.
 * @returns {string} UUID (Universally Unique Identifier) milik Agent ini.
 */
function getOrCreateUUID() {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.uuid) return config.uuid;
    }
  } catch (err) {
    console.error('Error reading config, generating new UUID:', err.message);
  }
  
  const newUuid = crypto.randomUUID();
  try {
    fs.writeFileSync(configPath, JSON.stringify({ uuid: newUuid }, null, 2));
  } catch (err) {
    console.error('Error writing config:', err.message);
  }
  return newUuid;
}

/**
 * Membuat jendela aplikasi utama (BrowserWindow).
 * Menghitung koordinat X dan Y agar jendela selalu muncul di sudut kanan bawah layar
 * (dekat area tray/jam Windows), serta mematikan "backgroundThrottling" 
 * agar proses telemetri tidak tersendat (throttled) saat aplikasi berada di latar belakang.
 */
function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const { x: workAreaX, y: workAreaY } = primaryDisplay.workArea;

  const windowWidth = 380;
  const windowHeight = 520;

  // Kalkulasi agar jendela melayang di ujung kanan bawah (15px padding)
  const x = workAreaX + screenWidth - windowWidth - 15;
  const y = workAreaY + screenHeight - windowHeight - 15;

  // Mengecek apakah aplikasi dijalankan dari Startup otomatis
  const isHiddenBoot = process.argv.includes('--hidden');

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: x,
    y: y,
    resizable: false,
    autoHideMenuBar: true,
    show: !isHiddenBoot, // Sembunyikan otomatis jika berjalan saat Windows baru menyala
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false // SANGAT KRUSIAL: Mencegah penurunan FPS ke 1Hz saat diminimize
    }
  });

  // Saat jendela ditutup lewat tombol X, aplikasi hanya disembunyikan (minimize ke tray), bukan dimatikan.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

/**
 * Membuat ikon Sistem Tray (di sudut kanan bawah taskbar).
 * Mendaftarkan menu konteks (klik kanan) untuk memunculkan atau mematikan aplikasi sepenuhnya.
 */
function createTray() {
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
  
  // Memunculkan jendela utama saat ikon tray di-klik kiri
  tray.on('click', () => {
    mainWindow.show();
  });
}


// Memastikan hanya ada 1 instansi aplikasi yang berjalan (Single Instance Lock)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Inisialisasi utama Electron
app.whenReady().then(() => {
  // Setup Auto Updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  
  autoUpdater.on('update-downloaded', (info) => {
    // Memberikan notifikasi bahwa update siap dipasang
    new Notification({
      title: 'Pembaruan AudioMonitor Siap!',
      body: 'Versi terbaru telah diunduh. Aplikasi akan diperbarui otomatis saat ditutup atau PC direstart.'
    }).show();
  });
  
  // Lakukan pengecekan versi setiap kali aplikasi dinyalakan
  autoUpdater.checkForUpdatesAndNotify().catch(err => console.error("Update check failed:", err));
  // Memberikan izin otomatis untuk permintaan perangkat keras (seperti mikrofon) 
  // tanpa memunculkan dialog popup yang mengganggu ke user
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return true;
  });

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

// ============================================
// IPC Handlers (Jembatan komunikasi UI ke Sistem)
// ============================================

ipcMain.on('write-log', (event, { level, message }) => {
  writeAgentLog(level, message);
});

ipcMain.handle('get-uuid', () => {
  return getOrCreateUUID();
});

ipcMain.handle('get-autostart', () => {
  return app.getLoginItemSettings().openAtLogin;
});

// Mengatur agar aplikasi menyala otomatis (Startup) ketika Windows boot
ipcMain.on('set-autostart', (event, enable) => {
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: app.getPath('exe'),
    args: ['--hidden']
  });
});

let previousCpus = require('os').cpus();

/**
 * Menghitung penggunaan CPU (%) dan RAM (%) dari sistem operasi.
 * Membandingkan waktu 'idle' dan waktu prosesor total sejak pemanggilan sebelumnya 
 * untuk menghasilkan angka load CPU yang akurat (seperti di Task Manager).
 */
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
  
  // Get local IP address
  const interfaces = os.networkInterfaces();
  let localIp = 'Unknown IP';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
    if (localIp !== 'Unknown IP') break;
  }

  return {
    ramUsage,
    cpuUsage,
    localIp
  };
});


// ==========================================
// AUDIO RECORDING LOGIC
// ==========================================
let audioWriteStream = null;

ipcMain.on('start-recording', (event, { agentName }) => {
  try {
    const docPath = app.getPath('documents');
    const recordDir = path.join(docPath, 'AudioMonitor-Recordings');
    if (!fs.existsSync(recordDir)) {
      fs.mkdirSync(recordDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = (agentName || 'Agent').replace(/[^a-z0-9]/gi, '_');
    const filename = `${safeName}_${timestamp}.webm`;
    const filePath = path.join(recordDir, filename);
    
    audioWriteStream = fs.createWriteStream(filePath);
    writeAgentLog('INFO', `Memulai perekaman audio ke: ${filePath}`);
  } catch (error) {
    writeAgentLog('ERROR', `Gagal memulai perekaman: ${error.message}`);
  }
});

ipcMain.on('save-audio-chunk', (event, arrayBuffer) => {
  if (audioWriteStream) {
    audioWriteStream.write(Buffer.from(arrayBuffer));
  }
});

ipcMain.on('stop-recording', (event) => {
  if (audioWriteStream) {
    audioWriteStream.end();
    audioWriteStream = null;
    writeAgentLog('INFO', 'Perekaman audio dihentikan dan disimpan.');
  }
});

// Menampilkan Pop-Up Notifikasi Windows
ipcMain.on('show-notification', (event, { title, body }) => {
  new Notification({ title, body }).show();
});
