const fs = require('fs');
const path = require('path');
const util = require('util');

const LOGS_DIR = path.join(__dirname, '../../logs');

if (!fs.existsSync(LOGS_DIR)) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  } catch (e) {}
}

// In-Memory Ring Buffer untuk performa kueri cepat dan streaming real-time
const MAX_MEMORY_LOGS = 1000;
const memoryLogs = [];
let logIdCounter = 0;

// Daftar listener real-time (Socket.io broadcaster)
const listeners = new Set();

/**
 * Mendapatkan nama berkas log harian berdasarkan tanggal
 */
function getLogFileName(customDate = null) {
  const date = customDate instanceof Date ? customDate : (customDate ? new Date(customDate) : new Date());
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return path.join(LOGS_DIR, `server-${yyyy}-${mm}-${dd}.log`);
}

/**
 * Mengekstrak tag modul (misal: [StorageHub], [Whisper], [Auth]) dari pesan log
 */
function parseLogTag(rawMessage) {
  if (!rawMessage || typeof rawMessage !== 'string') return { tag: 'System', cleanMessage: rawMessage || '' };
  
  const tagMatch = rawMessage.match(/^\[([a-zA-Z0-9_\-:]+)\]\s*(.*)$/);
  if (tagMatch) {
    return {
      tag: tagMatch[1],
      cleanMessage: tagMatch[2] || ''
    };
  }
  return { tag: 'System', cleanMessage: rawMessage };
}

/**
 * Menulis log dengan level tertentu dan menyebarkannya ke memori, berkas, dan listener
 */
function writeLog(level, ...args) {
  const now = new Date();
  const timeString = now.toTimeString().split(' ')[0]; // HH:MM:SS
  const isoTimestamp = now.toISOString();
  
  const formattedMessage = util.format(...args);
  const { tag, cleanMessage } = parseLogTag(formattedMessage);
  
  const logLine = `[${timeString}] [${level}] ${formattedMessage}\n`;
  
  // Output ke console stdout / stderr
  if (level === 'ERROR' || level === 'WARN') {
    console.error(logLine.trim());
  } else {
    console.log(logLine.trim());
  }

  const logEntry = {
    id: ++logIdCounter,
    timestamp: isoTimestamp,
    timeString,
    level,
    tag,
    message: formattedMessage,
    cleanMessage,
    raw: logLine.trim()
  };

  // Simpan ke memory ring buffer
  memoryLogs.push(logEntry);
  if (memoryLogs.length > MAX_MEMORY_LOGS) {
    memoryLogs.shift();
  }

  // Tulis ke berkas log harian
  try {
    const logFile = getLogFileName(now);
    fs.appendFileSync(logFile, logLine);
  } catch (err) {}

  // Broadcast ke seluruh listener terdaftar (misal Socket.io)
  for (const listener of listeners) {
    try {
      listener(logEntry);
    } catch (lErr) {}
  }

  return logEntry;
}

const logger = {
  info: (...args) => writeLog('INFO', ...args),
  warn: (...args) => writeLog('WARN', ...args),
  error: (...args) => writeLog('ERROR', ...args),
  debug: (...args) => writeLog('DEBUG', ...args),
  audit: (...args) => writeLog('AUDIT', ...args),
  
  writeLog,

  /**
   * Mendaftarkan listener untuk menerima stream log secara real-time
   */
  subscribe: (callback) => {
    if (typeof callback === 'function') {
      listeners.add(callback);
    }
    return () => {
      listeners.delete(callback);
    };
  },

  /**
   * Mengambil log terbaru dari memory buffer dengan opsi filter
   */
  getRecentLogs: (limit = 200, filters = {}) => {
    const { level, search, tag } = filters;
    let results = [...memoryLogs];

    if (level && level !== 'ALL') {
      results = results.filter(item => item.level.toUpperCase() === level.toUpperCase());
    }

    if (tag && tag !== 'ALL') {
      results = results.filter(item => item.tag.toLowerCase() === tag.toLowerCase());
    }

    if (search && typeof search === 'string' && search.trim() !== '') {
      const q = search.trim().toLowerCase();
      results = results.filter(item => item.message.toLowerCase().includes(q) || item.tag.toLowerCase().includes(q));
    }

    const safeLimit = Math.max(1, Math.min(limit || 200, 1000));
    return results.slice(Math.max(results.length - safeLimit, 0));
  },

  /**
   * Mengambil dan mem-parsing log untuk tanggal spesifik dari disk
   */
  getLogsForDate: (dateStr, filters = {}) => {
    const { level, search, tag, limit = 500, offset = 0 } = filters;
    let targetFile = getLogFileName();
    
    if (dateStr && typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      targetFile = path.join(LOGS_DIR, `server-${dateStr}.log`);
    }

    if (!fs.existsSync(targetFile)) {
      return { total: 0, logs: [], raw: 'Berkas log untuk tanggal tersebut tidak ditemukan.' };
    }

    try {
      const content = fs.readFileSync(targetFile, 'utf8');
      const lines = content.trim().split('\n').filter(l => l.trim().length > 0);
      
      const parsedLogs = lines.map((line, index) => {
        // Format: [HH:MM:SS] [LEVEL] Message
        const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*\[([A-Z]+)\]\s*(.*)$/);
        if (match) {
          const timeString = match[1];
          const logLevel = match[2];
          const message = match[3];
          const { tag: parsedTag, cleanMessage } = parseLogTag(message);
          return {
            id: index + 1,
            timeString,
            level: logLevel,
            tag: parsedTag,
            message,
            cleanMessage,
            raw: line
          };
        }
        return {
          id: index + 1,
          timeString: '',
          level: 'INFO',
          tag: 'System',
          message: line,
          cleanMessage: line,
          raw: line
        };
      });

      let filtered = parsedLogs;

      if (level && level !== 'ALL') {
        filtered = filtered.filter(item => item.level.toUpperCase() === level.toUpperCase());
      }

      if (tag && tag !== 'ALL') {
        filtered = filtered.filter(item => item.tag.toLowerCase() === tag.toLowerCase());
      }

      if (search && typeof search === 'string' && search.trim() !== '') {
        const q = search.trim().toLowerCase();
        filtered = filtered.filter(item => item.message.toLowerCase().includes(q) || item.tag.toLowerCase().includes(q));
      }

      const total = filtered.length;
      const paginated = filtered.slice(offset, offset + limit);

      return {
        total,
        logs: paginated,
        filePath: targetFile
      };
    } catch (err) {
      return { total: 0, logs: [], error: err.message };
    }
  },

  /**
   * Mengambil daftar tanggal berkas log yang tersedia
   */
  listLogDates: () => {
    if (!fs.existsSync(LOGS_DIR)) return [];
    try {
      const files = fs.readdirSync(LOGS_DIR);
      const logFiles = [];

      for (const file of files) {
        const match = file.match(/^server-(\d{4}-\d{2}-\d{2})\.log$/);
        if (match) {
          const filePath = path.join(LOGS_DIR, file);
          try {
            const stat = fs.statSync(filePath);
            logFiles.push({
              date: match[1],
              fileName: file,
              sizeBytes: stat.size,
              sizeFormatted: (stat.size / 1024).toFixed(1) + ' KB',
              mtime: stat.mtime
            });
          } catch (e) {}
        }
      }

      // Urutkan dari tanggal terbaru ke terlama
      logFiles.sort((a, b) => b.date.localeCompare(a.date));
      return logFiles;
    } catch (err) {
      return [];
    }
  },

  /**
   * Membersihkan berkas log lawas yang melebihi batas retensi hari
   */
  cleanOldLogs: (retentionDays = 30) => {
    if (!fs.existsSync(LOGS_DIR)) return { deletedCount: 0, freedBytes: 0 };
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    let deletedCount = 0;
    let freedBytes = 0;

    try {
      const files = fs.readdirSync(LOGS_DIR);
      for (const file of files) {
        if (file.startsWith('server-') && file.endsWith('.log')) {
          const filePath = path.join(LOGS_DIR, file);
          try {
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs < cutoffTime) {
              freedBytes += stat.size;
              fs.unlinkSync(filePath);
              deletedCount++;
            }
          } catch (e) {}
        }
      }
    } catch (err) {}

    return { deletedCount, freedBytes };
  },

  /**
   * Mengosongkan memory ring buffer
   */
  clearMemoryLogs: () => {
    memoryLogs.length = 0;
  },

  /**
   * Mengambil path absolut berkas log harian
   */
  getLogFilePath: (dateStr = null) => {
    return getLogFileName(dateStr);
  },

  /**
   * Kompatibilitas mundur: Mengambil log hari ini dalam format teks
   */
  getTodayLogs: () => {
    const logFile = getLogFileName();
    if (fs.existsSync(logFile)) {
      try {
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.trim().split('\n');
        return lines.slice(Math.max(lines.length - 200, 0)).join('\n');
      } catch (err) {
        return 'Error reading log file.';
      }
    }
    return 'No logs for today.';
  }
};

module.exports = logger;
