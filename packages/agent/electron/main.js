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
      { label: 'Buka Folder Log', click: () => { require('electron').shell.openPath(logsDir); } },
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
ipcMain.handle('get-windows-audio-devices', async () => {
  if (process.platform !== 'win32') return {};
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    const cmd = `powershell -NoProfile -Command "Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture\\*\\Properties' | Select-Object PSPath, '{a45c254e-df1c-4efd-8020-67d146a850e0},2', '{b3f8fa53-0004-438e-9003-51a46e139bfc},6' | ConvertTo-Json"`;
    const { stdout } = await execAsync(cmd);
    const data = JSON.parse(stdout || '[]');
    const mapping = {};
    const items = Array.isArray(data) ? data : [data];
    items.forEach(item => {
      if (item && item.PSPath) {
        const idMatch = item.PSPath.match(/{[0-9a-fA-F-]+}/);
        if (idMatch) {
          const id = idMatch[0].toLowerCase();
          const part1 = item['{a45c254e-df1c-4efd-8020-67d146a850e0},2'];
          const part2 = item['{b3f8fa53-0004-438e-9003-51a46e139bfc},6'];
          let name = '';
          if (part1 && part2) name = part1 + ' (' + part2 + ')';
          else if (part1) name = part1;
          else if (part2) name = part2;
          if (name) mapping[id] = name;
        }
      }
    });
    return mapping;
  } catch (err) {
    return {};
  }
});

ipcMain.handle('get-obs-global-device', async (event, { collectionName, deviceKey }) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const jsonPath = path.join(process.env.APPDATA || process.env.USERPROFILE + '\\AppData\\Roaming', 'obs-studio', 'basic', 'scenes', `${collectionName}.json`);
    if (!fs.existsSync(jsonPath)) return null;
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (data[deviceKey] && data[deviceKey].settings && data[deviceKey].settings.device_id) {
      return data[deviceKey].settings.device_id;
    }
    return null;
  } catch (err) {
    return null;
  }
});

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

ipcMain.on('open-logs-folder', () => { require('electron').shell.openPath(logsDir); });

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

function uploadToServer(filePath, serverUrl, agentName, sessionFolder) {
  writeAgentLog('INFO', `[Upload] Mencoba mengirim file ${path.basename(filePath)} ke ${serverUrl}`);
  if (!serverUrl || serverUrl.trim() === '') {
     writeAgentLog('ERROR', '[Upload Gagal] IP Server kosong atau tidak valid!');
     return;
  }
  const http = require('http');
  const https = require('https');
  const { URL } = require('url');
  
  try {
    let normalizedUrl = (serverUrl || 'localhost:4000').trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `http://${normalizedUrl}`;
    }
    const urlObj = new URL(normalizedUrl);
    if (!urlObj.port) {
      urlObj.port = '4000';
    }
    
    urlObj.pathname = '/internal/upload-record';
    const fileName = path.basename(filePath);
    const lib = urlObj.protocol === 'https:' ? https : http;
    
    const stats = fs.statSync(filePath);
    const options = {
      method: 'POST',
      headers: {
        'x-agent-name': agentName || 'UnknownAgent',
        'x-session-folder': sessionFolder,
        'x-file-name': fileName,
        'Content-Type': 'application/octet-stream',
        'Content-Length': stats.size
      }
    };
    
    writeAgentLog('INFO', `Mengunggah file rekaman ke Server: ${urlObj.toString()}`);
    
    const req = lib.request(urlObj, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          writeAgentLog('INFO', `Sukses mengunggah ${fileName} ke Server.`);
        } else {
          writeAgentLog('ERROR', `Gagal mengunggah ${fileName} ke Server. Status: ${res.statusCode}, Respon: ${data}`);
        }
      });
    });
    
    req.on('error', (err) => {
      writeAgentLog('ERROR', `Koneksi gagal saat mengunggah ${fileName} ke Server: ${err.message}`);
    });
    
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(req);
  } catch (err) {
    writeAgentLog('ERROR', `Error fungsi uploadToServer: ${err.message}`);
  }
}

let currentSessionDir = null;
let currentAgentName = null;
let currentServerIp = null;
let pendingAudioChunks = [];


ipcMain.handle('select-folder', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});



ipcMain.on('start-recording', (event, { sessionFolderName, partNumber, recordDir, agentName, serverIp }) => {
    currentAgentName = agentName;
    currentServerIp = serverIp;
  try {
    if (audioWriteStream) {
      audioWriteStream.end();
      audioWriteStream = null;
    }

    const baseDir = recordDir && recordDir.trim() !== '' ? recordDir : path.join(app.getPath('documents'), 'AudioMonitor-Recordings');
    const sessionDir = path.join(baseDir, sessionFolderName || 'UnknownSession');
    currentSessionDir = sessionDir;
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    const filename = `Part_${(partNumber || 1).toString().padStart(3, '0')}.webm`;
    const filePath = path.join(sessionDir, filename);

    audioWriteStream = fs.createWriteStream(filePath);

    // Flush any pending chunks (e.g. EBML header sent just before stream was ready)
    if (pendingAudioChunks.length > 0) {
      for (const chunk of pendingAudioChunks) {
        audioWriteStream.write(chunk);
      }
      pendingAudioChunks = [];
    }

    writeAgentLog('INFO', `Memulai perekaman audio ke: ${filePath}`);
  } catch (error) {
    writeAgentLog('ERROR', `Gagal memulai perekaman: ${error.message}`);
  }
});

ipcMain.on('save-audio-chunk', (event, arrayBuffer) => {
  const buf = Buffer.from(arrayBuffer);
  if (audioWriteStream) {
    audioWriteStream.write(buf);
  } else if (currentSessionDir && pendingAudioChunks.length < 10) {
    pendingAudioChunks.push(buf);
  }
});

ipcMain.on('stop-recording', (event, isRollover) => {
  if (!isRollover) {
    currentSessionDir = null;
    pendingAudioChunks = [];
  }
  if (audioWriteStream) {
    const streamToClose = audioWriteStream;
    const capturedSessionDir = currentSessionDir;
    const capturedAgentName = currentAgentName;
    const capturedServerIp = currentServerIp;
    
    if (audioWriteStream === streamToClose) {
      audioWriteStream = null;
    }
    
    streamToClose.end();
    streamToClose.on('close', () => {
      // Event close menjamin file descriptor sudah sepenuhnya dilepas oleh sistem operasi
      const finishedFilePath = streamToClose.path;
      let finalDirName = capturedSessionDir;

      if (!isRollover && capturedSessionDir && fs.existsSync(capturedSessionDir)) {
        try {
          const now = new Date();
          const endHours = String(now.getHours()).padStart(2, '0');
          const endMinutes = String(now.getMinutes()).padStart(2, '0');
          const endSeconds = String(now.getSeconds()).padStart(2, '0');
          const stopTime = `${endHours}-${endMinutes}-${endSeconds}`;
          
          const newDirName = `${capturedSessionDir}_to_${stopTime}`;
          fs.renameSync(capturedSessionDir, newDirName);
          finalDirName = newDirName;
          writeAgentLog('INFO', `Perekaman audio dihentikan dan folder disimpan sebagai: ${newDirName}`);
        } catch (err) {
          writeAgentLog('ERROR', `Gagal mengubah nama folder: ${err.message}`);
          
          // Fallback coba sekali lagi dengan setTimeout jika OS masih lambat melepas lock
          setTimeout(() => {
            try {
              const now = new Date();
              const endHours = String(now.getHours()).padStart(2, '0');
              const endMinutes = String(now.getMinutes()).padStart(2, '0');
              const endSeconds = String(now.getSeconds()).padStart(2, '0');
              const stopTime = `${endHours}-${endMinutes}-${endSeconds}`;
              const newDirName2 = `${capturedSessionDir}_to_${stopTime}`;
              fs.renameSync(capturedSessionDir, newDirName2);
              finalDirName = newDirName2;
              writeAgentLog('INFO', `Berhasil mengubah nama folder pada percobaan kedua.`);
            } catch (err2) {
               writeAgentLog('ERROR', `Tetap gagal rename pada percobaan kedua: ${err2.message}`);
            }
          }, 1500);
        }
      } else {
        writeAgentLog('INFO', 'Perekaman chunk audio dihentikan.');
      }

      // Mulai proses upload
      setTimeout(() => {
         if (!finalDirName) return;
         const sessionFolderName = path.basename(finalDirName);
         const finalFilePath = path.join(finalDirName, path.basename(finishedFilePath));
         if (fs.existsSync(finalFilePath)) {
            uploadToServer(finalFilePath, capturedServerIp, capturedAgentName, sessionFolderName);
         }
      }, !isRollover ? 2000 : 500); // Tunggu lebih lama jika ada potensi fallback rename
    });
  }
});

// Menampilkan Pop-Up Notifikasi Windows
ipcMain.on('show-notification', (event, { title, body }) => {
  new Notification({ title, body }).show();
});
