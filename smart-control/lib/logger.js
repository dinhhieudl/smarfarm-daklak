const fs = require('fs');
const path = require('path');

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || 2;

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

function formatTimestamp() {
  return new Date().toISOString();
}

function formatMessage(level, category, message, data) {
  const entry = {
    timestamp: formatTimestamp(),
    level,
    category,
    message,
    ...(data && Object.keys(data).length > 0 && { data }),
    pid: process.pid
  };
  return JSON.stringify(entry);
}

function rotateIfNeeded(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_LOG_SIZE) {
      const archive = filePath.replace('.log', `-${Date.now()}.log`);
      fs.renameSync(filePath, archive);
    }
  } catch {}
}

function writeToFile(filename, entry) {
  const filePath = path.join(LOG_DIR, filename);
  rotateIfNeeded(filePath);
  fs.appendFile(filePath, entry + '\n', (err) => {
    if (err) console.error('[Logger] Write error:', err.message);
  });
}

function log(level, category, message, data) {
  if (LOG_LEVELS[level] > currentLevel) return;

  const entry = formatMessage(level, category, message, data);

  if (level === 'error') {
    console.error(entry);
    writeToFile('error.log', entry);
  } else if (level === 'warn') {
    console.warn(entry);
    writeToFile('warn.log', entry);
  } else {
    console.log(entry);
    if (process.env.NODE_ENV === 'production') {
      writeToFile('app.log', entry);
    }
  }
}

module.exports = {
  error: (category, message, data) => log('error', category, message, data),
  warn: (category, message, data) => log('warn', category, message, data),
  info: (category, message, data) => log('info', category, message, data),
  debug: (category, message, data) => log('debug', category, message, data),

  middleware: (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      log(level, 'http', `${req.method} ${req.path}`, {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip || req.connection?.remoteAddress
      });
    });
    next();
  }
};
