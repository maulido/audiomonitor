const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../../logs');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function getLogFileName() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return path.join(LOGS_DIR, `server-${yyyy}-${mm}-${dd}.log`);
}

function writeLog(level, ...args) {
  const logFile = getLogFileName();
  const now = new Date();
  
  const timeString = now.toTimeString().split(' ')[0]; // HH:MM:SS
  
  // Format the arguments into a single string
  const util = require('util');
  const message = util.format(...args);
  const logLine = `[${timeString}] [${level}] ${message}\n`;
  
  if (level === 'ERROR' || level === 'WARN') {
    console.error(logLine.trim());
  } else {
    console.log(logLine.trim());
  }

  try {
    fs.appendFileSync(logFile, logLine);
  } catch (err) {}
}

const logger = {
  info: (...args) => writeLog('INFO', ...args),
  warn: (...args) => writeLog('WARN', ...args),
  error: (...args) => writeLog('ERROR', ...args),
  debug: (...args) => writeLog('DEBUG', ...args),
  
  getTodayLogs: () => {
    const logFile = getLogFileName();
    if (fs.existsSync(logFile)) {
      try {
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.trim().split('\n');
        return lines.slice(Math.max(lines.length - 200, 0)).join('\n');
      } catch (err) {
        return "Error reading log file.";
      }
    }
    return "No logs for today.";
  }
};

module.exports = logger;
