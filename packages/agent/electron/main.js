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
  try { fs.appendFileSync(getLogFile(), line); } catch (e) { }
}
// --------------------

const isDev = process.env.NODE_ENV === 'development';
const configPath = path.join(app.getPath('userData'), 'config.json');

let mainWindow = null;
let tray = null;
let isQuitting = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

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
    const windowHeight = 480;

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
    // Daftarkan AppUserModelId agar Notifikasi Toast Windows dikenali dengan benar
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.audiomonitor.agent');
    }

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

  ipcMain.on('resize-window', (event, { width, height }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        const { x: workAreaX, y: workAreaY } = primaryDisplay.workArea;
        const currentBounds = mainWindow.getBounds();
        const newWidth = width || currentBounds.width;
        const newHeight = height || currentBounds.height;
        const newX = workAreaX + screenWidth - newWidth - 15;
        const newY = workAreaY + screenHeight - newHeight - 15;
        mainWindow.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
      } catch (err) {
        writeAgentLog('WARN', `[Window] Error resizing window: ${err.message}`);
      }
    }
  });

  ipcMain.handle('get-uuid', () => {
    return getOrCreateUUID();
  });

  let agentAutoLauncher = null;
  function getAgentAutoLauncher() {
    if (!agentAutoLauncher) {
      try {
        const AutoLaunch = require('auto-launch');
        agentAutoLauncher = new AutoLaunch({
          name: 'AudioMonitor_Agent',
          path: app.getPath('exe'),
        });
      } catch (e) {
        writeAgentLog('WARN', `[Autostart] Gagal memuat auto-launch: ${e.message}`);
      }
    }
    return agentAutoLauncher;
  }

  ipcMain.handle('get-autostart', async () => {
    const launcher = getAgentAutoLauncher();
    if (launcher) {
      try {
        const isEnabled = await launcher.isEnabled();
        return Boolean(isEnabled);
      } catch (err) {
        writeAgentLog('WARN', `[Autostart] Error checking auto-launch: ${err.message}`);
      }
    }
    try {
      const settings = app.getLoginItemSettings();
      return typeof settings.openAtLogin === 'boolean' ? settings.openAtLogin : null;
    } catch (err) {
      writeAgentLog('ERROR', `[Autostart] Error reading autostart: ${err.message}`);
      return null;
    }
  });

  // Mengatur agar aplikasi menyala otomatis (Startup) ketika Windows boot
  ipcMain.handle('set-autostart', async (event, enable) => {
    const isEnable = Boolean(enable);
    const launcher = getAgentAutoLauncher();
    if (launcher) {
      try {
        if (isEnable) {
          await launcher.enable();
        } else {
          await launcher.disable();
        }
        const isEnabled = await launcher.isEnabled();
        writeAgentLog('INFO', `[Autostart] auto-launch berhasil diubah ke: ${isEnabled}`);
        return Boolean(isEnabled);
      } catch (err) {
        writeAgentLog('WARN', `[Autostart] auto-launch fallback to Electron API: ${err.message}`);
      }
    }

    try {
      if (app.isPackaged) {
        app.setLoginItemSettings({
          openAtLogin: isEnable,
          openAsHidden: true,
          path: process.execPath,
          args: ['--hidden']
        });
      } else {
        app.setLoginItemSettings({
          openAtLogin: isEnable,
          openAsHidden: true
        });
      }
      const current = app.getLoginItemSettings().openAtLogin;
      writeAgentLog('INFO', `[Autostart] Pengaturan autostart diubah ke: ${isEnable} (Status sistem: ${current})`);
      return isEnable;
    } catch (err) {
      writeAgentLog('ERROR', `[Autostart] Gagal mengatur autostart: ${err.message}`);
      return isEnable;
    }
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
      if (!cpu || !cpu.times) continue;
      const prevCpu = (previousCpus && previousCpus[i]) || cpu;
      if (!prevCpu || !prevCpu.times) continue;

      let cpuTotal = 0;
      for (let type in cpu.times) cpuTotal += cpu.times[type];

      let prevTotal = 0;
      for (let type in prevCpu.times) prevTotal += prevCpu.times[type];

      totalDelta += (cpuTotal - prevTotal);
      idleDelta += ((cpu.times.idle || 0) - (prevCpu.times.idle || 0));
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
      if (!urlObj.port && (urlObj.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(urlObj.hostname))) {
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
            // Tulis marker bahwa file audio ini telah berhasil terunggah ke Server
            try {
              const markerPath = `${filePath}.uploaded`;
              fs.writeFileSync(markerPath, JSON.stringify({
                uploadedAt: new Date().toISOString(),
                size: stats.size,
                fileName,
                serverUrl: urlObj.origin
              }), 'utf8');
            } catch (mErr) {
              writeAgentLog('WARN', `Gagal menulis marker uploaded: ${mErr.message}`);
            }
          } else {
            writeAgentLog('ERROR', `Gagal mengunggah ${fileName} ke Server. Status: ${res.statusCode}, Respon: ${data}`);
          }
        });
      });

      req.setTimeout(60000, () => {
        req.destroy(new Error('Timeout upload rekaman ke Server (60s)'));
      });

      const readStream = fs.createReadStream(filePath);
      readStream.on('error', (rErr) => {
        writeAgentLog('ERROR', `Read stream error ${fileName}: ${rErr.message}`);
        req.destroy();
      });

      req.on('error', (err) => {
        writeAgentLog('ERROR', `Koneksi gagal saat mengunggah ${fileName} ke Server: ${err.message}`);
        try { readStream.destroy(); } catch (e) { }
      });

      readStream.pipe(req);
    } catch (err) {
      writeAgentLog('ERROR', `Error fungsi uploadToServer: ${err.message}`);
    }
  }

  // Background Worker: Auto-Retry upload file audio yang belum terupload saat server sempat offline
  let isRetryingUploads = false;
  function retryPendingUploads(recordDir, serverIp, agentName) {
    if (isRetryingUploads || !serverIp || serverIp.trim() === '') return;
    const baseDir = recordDir && recordDir.trim() !== ''
      ? recordDir
      : path.join(app.getPath('documents'), 'AudioMonitor-Recordings');

    if (!fs.existsSync(baseDir)) return;

    isRetryingUploads = true;
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionPath = path.join(baseDir, entry.name);

        // Jangan sentuh sesi yang sedang aktif merekam saat ini
        if (currentSessionDir && (path.resolve(currentSessionDir) === path.resolve(sessionPath) || path.resolve(currentSessionDir).startsWith(path.resolve(sessionPath)))) {
          continue;
        }

        const files = fs.readdirSync(sessionPath);
        for (const f of files) {
          if (f.toLowerCase().endsWith('.webm') || f.toLowerCase().endsWith('.wav') || f.toLowerCase().endsWith('.mp3')) {
            const filePath = path.join(sessionPath, f);
            const markerPath = `${filePath}.uploaded`;
            if (!fs.existsSync(markerPath)) {
              writeAgentLog('INFO', `[AutoRetry] Mengunggah ulang file rekaman pending: ${entry.name}/${f}`);
              uploadToServer(filePath, serverIp, agentName, entry.name);
            }
          }
        }
      }
    } catch (err) {
      writeAgentLog('WARN', `Error pada retryPendingUploads: ${err.message}`);
    } finally {
      isRetryingUploads = false;
    }
  }

  // Jalankan retry background scanner setiap 60 detik
  setInterval(() => {
    if (currentServerIp) {
      retryPendingUploads(null, currentServerIp, currentAgentName);
    }
  }, 60000);

  let currentSessionDir = null;
  let currentAgentName = null;
  let currentServerIp = null;
  let pendingAudioChunks = [];
  let audioWriteStream = null;


  ipcMain.handle('select-folder', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // Mengambil ringkasan penggunaan penyimpanan rekaman audio lokal di PC Host
  ipcMain.handle('get-storage-info', async (event, customRecordDir) => {
    const baseDir = customRecordDir && customRecordDir.trim() !== ''
      ? customRecordDir
      : path.join(app.getPath('documents'), 'AudioMonitor-Recordings');

    if (!fs.existsSync(baseDir)) {
      return {
        exists: false,
        baseDir,
        totalBytes: 0,
        totalMb: '0.0',
        totalGb: '0.00',
        uploadedBytes: 0,
        uploadedMb: '0.0',
        pendingBytes: 0,
        pendingMb: '0.0',
        folderCount: 0,
        uploadedFolderCount: 0,
        pendingFolderCount: 0,
        fileCount: 0,
        sessions: []
      };
    }

    let totalBytes = 0;
    let uploadedBytes = 0;
    let fileCount = 0;
    let uploadedFolderCount = 0;
    const sessions = [];

    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionPath = path.join(baseDir, entry.name);
          let sessionBytes = 0;
          let sessionFiles = 0;
          let mtime = null;
          let audioFilesCount = 0;
          let uploadedFilesCount = 0;

          try {
            const files = fs.readdirSync(sessionPath);
            for (const f of files) {
              const filePath = path.join(sessionPath, f);
              try {
                const stat = fs.statSync(filePath);
                sessionBytes += stat.size;
                sessionFiles++;
                if (!mtime || stat.mtime > mtime) mtime = stat.mtime;

                if (f.toLowerCase().endsWith('.webm') || f.toLowerCase().endsWith('.wav') || f.toLowerCase().endsWith('.mp3')) {
                  audioFilesCount++;
                  if (fs.existsSync(`${filePath}.uploaded`)) {
                    uploadedFilesCount++;
                  }
                }
              } catch (e) { }
            }
          } catch (e) { }

          const isFullyUploaded = audioFilesCount > 0 && uploadedFilesCount >= audioFilesCount;
          if (isFullyUploaded) {
            uploadedBytes += sessionBytes;
            uploadedFolderCount++;
          }

          totalBytes += sessionBytes;
          fileCount += sessionFiles;
          sessions.push({
            name: entry.name,
            path: sessionPath,
            bytes: sessionBytes,
            mb: (sessionBytes / 1024 / 1024).toFixed(1),
            fileCount: sessionFiles,
            audioFilesCount,
            uploadedFilesCount,
            isFullyUploaded,
            mtime: mtime ? mtime.toISOString() : null,
            isCurrentActive: currentSessionDir && path.resolve(currentSessionDir).startsWith(path.resolve(sessionPath))
          });
        }
      }
    } catch (err) {
      writeAgentLog('ERROR', `Gagal membaca storage info: ${err.message}`);
    }

    const pendingBytes = Math.max(0, totalBytes - uploadedBytes);

    return {
      exists: true,
      baseDir,
      totalBytes,
      totalMb: (totalBytes / 1024 / 1024).toFixed(1),
      totalGb: (totalBytes / 1024 / 1024 / 1024).toFixed(2),
      uploadedBytes,
      uploadedMb: (uploadedBytes / 1024 / 1024).toFixed(1),
      pendingBytes,
      pendingMb: (pendingBytes / 1024 / 1024).toFixed(1),
      folderCount: sessions.length,
      uploadedFolderCount,
      pendingFolderCount: sessions.length - uploadedFolderCount,
      fileCount,
      sessions
    };
  });

  // Menghapus file rekaman lokal di PC Host (HANYA yang sudah terupload ke Server)
  ipcMain.handle('delete-local-recordings', async (event, { recordDir, deleteMode = 'all', days = 0, onlyUploaded = true } = {}) => {
    const baseDir = recordDir && recordDir.trim() !== ''
      ? recordDir
      : path.join(app.getPath('documents'), 'AudioMonitor-Recordings');

    if (!fs.existsSync(baseDir)) {
      return { success: true, deletedFolders: 0, freedBytes: 0, freedMb: '0.0', skippedUnuploaded: 0 };
    }

    let deletedFolders = 0;
    let freedBytes = 0;
    let skippedUnuploaded = 0;
    const cutoffTime = days > 0 ? Date.now() - (days * 24 * 60 * 60 * 1000) : null;

    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const sessionPath = path.join(baseDir, entry.name);

        // Jangan hapus sesi yang sedang aktif merekam saat ini
        if (currentSessionDir && (path.resolve(currentSessionDir) === path.resolve(sessionPath) || path.resolve(currentSessionDir).startsWith(path.resolve(sessionPath)))) {
          continue;
        }

        let sessionBytes = 0;
        let newestMtime = 0;
        let audioFiles = [];
        let allAudioUploaded = true;

        try {
          const files = fs.readdirSync(sessionPath);
          for (const f of files) {
            try {
              const filePath = path.join(sessionPath, f);
              const stat = fs.statSync(filePath);
              sessionBytes += stat.size;
              if (stat.mtimeMs > newestMtime) newestMtime = stat.mtimeMs;

              if (f.toLowerCase().endsWith('.webm') || f.toLowerCase().endsWith('.wav') || f.toLowerCase().endsWith('.mp3')) {
                audioFiles.push(f);
                if (!fs.existsSync(`${filePath}.uploaded`)) {
                  allAudioUploaded = false;
                }
              }
            } catch (e) { }
          }
        } catch (e) { }

        // KEBIJAKAN KEAMANAN DATA: Jika onlyUploaded aktif, jangan hapus jika ada file audio yang belum terupload!
        if (onlyUploaded !== false) {
          if (audioFiles.length > 0 && !allAudioUploaded) {
            skippedUnuploaded++;
            continue; // Lewati folder yang masih memiliki file audio yang belum terupload
          }
        }

        let shouldDelete = false;
        if (deleteMode === 'all') {
          shouldDelete = true;
        } else if (deleteMode === 'older_than_days' && cutoffTime) {
          const dateMatch = entry.name.match(/(\d{4})-(\d{2})-(\d{2})/);
          let folderTimestamp = newestMtime;
          if (dateMatch) {
            const parsedDate = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`).getTime();
            if (!isNaN(parsedDate)) folderTimestamp = parsedDate;
          }
          if (folderTimestamp > 0 && folderTimestamp < cutoffTime) {
            shouldDelete = true;
          }
        }

        if (shouldDelete) {
          try {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            deletedFolders++;
            freedBytes += sessionBytes;
          } catch (rmErr) {
            writeAgentLog('WARN', `Gagal menghapus folder ${entry.name}: ${rmErr.message}`);
          }
        }
      }
    } catch (err) {
      writeAgentLog('ERROR', `Gagal mengeksekusi penghapusan rekaman lokal: ${err.message}`);
      return { success: false, error: err.message, skippedUnuploaded };
    }

    writeAgentLog('INFO', `Pembersihan storage lokal PC Host (Khusus Terupload): ${deletedFolders} folder dihapus, membebaskan ${(freedBytes / 1024 / 1024).toFixed(1)} MB (${skippedUnuploaded} folder belum terupload dilindungi).`);

    return {
      success: true,
      deletedFolders,
      freedBytes,
      freedMb: (freedBytes / 1024 / 1024).toFixed(1),
      skippedUnuploaded
    };
  });

  // Membuka folder rekaman di Windows File Explorer
  ipcMain.handle('open-recordings-folder', async (event, recordDir) => {
    const { shell } = require('electron');
    const baseDir = recordDir && recordDir.trim() !== ''
      ? recordDir
      : path.join(app.getPath('documents'), 'AudioMonitor-Recordings');
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    await shell.openPath(baseDir);
    return true;
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
    try {
      if (!arrayBuffer) return;
      const buf = Buffer.from(arrayBuffer);
      if (audioWriteStream) {
        audioWriteStream.write(buf);
      } else if (currentSessionDir && pendingAudioChunks.length < 120) {
        pendingAudioChunks.push(buf);
      }
    } catch (err) {
      writeAgentLog('WARN', `Gagal memproses save-audio-chunk: ${err.message}`);
    }
  });

  ipcMain.on('stop-recording', (event, isRollover) => {
    const capturedSessionDir = currentSessionDir;
    const capturedAgentName = currentAgentName;
    const capturedServerIp = currentServerIp;

    if (!isRollover) {
      currentSessionDir = null;
      pendingAudioChunks = [];
    }

    if (audioWriteStream) {
      const streamToClose = audioWriteStream;

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

  // Menampilkan Pop-Up Notifikasi Windows Host
  ipcMain.on('show-notification', (event, { title, body, sound = true, urgency = 'normal' }) => {
    if (!Notification.isSupported()) {
      writeAgentLog('WARN', 'Notifikasi sistem tidak didukung di lingkungan ini');
      return;
    }

    try {
      let iconPath = path.join(__dirname, '../public/icon.png');
      if (!isDev) {
        iconPath = path.join(__dirname, '../dist/icon.png');
      }

      const notifOptions = {
        title: title || 'Audio Monitor Agent',
        body: body || '',
        silent: !sound,
        urgency: urgency || 'normal'
      };

      if (fs.existsSync(iconPath)) {
        notifOptions.icon = iconPath;
      }

      const notif = new Notification(notifOptions);

      // Saat pengguna mengklik notifikasi popup di layar Windows, buka dan fokuskan jendela Agent
      notif.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          if (!mainWindow.isVisible()) mainWindow.show();
          mainWindow.focus();
        }
      });

      notif.show();
      writeAgentLog('INFO', `[Notifikasi Windows] Ditampilkan: "${title}" - "${body}"`);
    } catch (err) {
      writeAgentLog('ERROR', `[Notifikasi Windows] Gagal menampilkan notifikasi: ${err.message}`);
    }
  });

  // Mengambil Versi Aplikasi
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // Mengunduh dan Menginstal Pembaruan dari Server LAN
  ipcMain.handle('install-update', async (event, downloadUrl) => {
    const http = require('http');
    const https = require('https');
    const { spawn } = require('child_process');

    if (!downloadUrl) return { success: false, error: 'URL pembaruan kosong' };

    writeAgentLog('INFO', `Menerima perintah pembaruan aplikasi dari: ${downloadUrl}`);
    const destPath = path.join(app.getPath('temp'), 'AudioMonitor_Agent_Update.exe');

    const downloadFile = (targetUrl, redirectCount = 0) => {
      return new Promise((resolve) => {
        if (redirectCount > 5) {
          return resolve({ success: false, error: 'Terlalu banyak redirect HTTP' });
        }

        let parsedUrl;
        try {
          parsedUrl = new URL(targetUrl);
        } catch (err) {
          return resolve({ success: false, error: `URL tidak valid: ${err.message}` });
        }

        const lib = parsedUrl.protocol === 'https:' ? https : http;
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return resolve({ success: false, error: `Protokol tidak didukung: ${parsedUrl.protocol}` });
        }

        // Hapus file temporary sebelumnya jika ada
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) { }

        const fileStream = fs.createWriteStream(destPath);
        let isResolved = false;
        const safeResolve = (val) => {
          if (!isResolved) {
            isResolved = true;
            resolve(val);
          }
        };

        const cleanupAndFail = (errMsg) => {
          fileStream.destroy();
          fs.unlink(destPath, () => { });
          writeAgentLog('ERROR', `Gagal update: ${errMsg}`);
          safeResolve({ success: false, error: errMsg });
        };

        const req = lib.get(parsedUrl, (res) => {
          // Handle HTTP Redirects (301, 302, 303, 307, 308)
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            fileStream.destroy();
            const nextUrl = new URL(res.headers.location, parsedUrl).toString();
            return resolve(downloadFile(nextUrl, redirectCount + 1));
          }

          if (res.statusCode !== 200) {
            return cleanupAndFail(`HTTP ${res.statusCode}`);
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let receivedBytes = 0;

          let activityTimeout = setTimeout(() => {
            req.destroy(new Error('Timeout koneksi unduh update (120s)'));
          }, 120000);

          res.on('data', (chunk) => {
            clearTimeout(activityTimeout);
            activityTimeout = setTimeout(() => {
              req.destroy(new Error('Timeout unduh tidak ada respon data (60s)'));
            }, 60000);

            receivedBytes += chunk.length;
            fileStream.write(chunk);
            if (totalBytes > 0 && event?.sender && !event.sender.isDestroyed()) {
              const percent = Math.round((receivedBytes / totalBytes) * 100);
              event.sender.send('update-progress', { progress: percent, status: 'downloading' });
            }
          });

          res.on('end', () => {
            clearTimeout(activityTimeout);
            if (totalBytes > 0 && receivedBytes < totalBytes) {
              return cleanupAndFail(`Unduhan terputus: ${receivedBytes}/${totalBytes} byte`);
            }
            fileStream.end();
          });

          res.on('error', (err) => {
            clearTimeout(activityTimeout);
            cleanupAndFail(`Stream error: ${err.message}`);
          });
        });

        req.on('error', (err) => cleanupAndFail(`Koneksi gagal: ${err.message}`));

        fileStream.on('error', (err) => {
          req.destroy();
          cleanupAndFail(`Gagal menulis file: ${err.message}`);
        });

        fileStream.on('finish', () => {
          writeAgentLog('INFO', 'Unduhan installer update selesai. Menjalankan silent install...');

          try {
            const stats = fs.statSync(destPath);
            if (stats.size < 1024 * 1024) {
              return cleanupAndFail(`File installer yang diunduh terlalu kecil atau korup (${stats.size} bytes)`);
            }
          } catch (sErr) {
            return cleanupAndFail(`Gagal memverifikasi file installer: ${sErr.message}`);
          }

          if (event?.sender && !event.sender.isDestroyed()) {
            event.sender.send('update-progress', { progress: 100, status: 'installing' });
          }

          try {
            // Eksekusi installer NSIS dengan flag /S (Silent install)
            const child = spawn(destPath, ['/S'], {
              detached: true,
              stdio: 'ignore'
            });

            child.on('error', (spawnErr) => {
              writeAgentLog('ERROR', `Gagal menjalankan installer: ${spawnErr.message}`);
              safeResolve({ success: false, error: `Spawn error: ${spawnErr.message}` });
            });

            child.unref();

            // Beri jeda 1.5 detik lalu tutup aplikasi agar installer dapat menimpa binary
            setTimeout(() => {
              app.quit();
            }, 1500);

            safeResolve({ success: true });
          } catch (execErr) {
            cleanupAndFail(`Eksekusi gagal: ${execErr.message}`);
          }
        });
      });
    };

    return await downloadFile(downloadUrl);
  });
}
