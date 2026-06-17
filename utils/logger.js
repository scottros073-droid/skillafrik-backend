// backend/utils/logger.js
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_TEST = process.env.NODE_ENV === 'test';
const defaultLevel = IS_PRODUCTION ? LOG_LEVELS.WARN : LOG_LEVELS.INFO;
const currentLevel = process.env.LOG_LEVEL ? LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] : defaultLevel;

const REDACTED_KEYS = new Set([
  'authorization',
  'cookie',
  'password',
  'token',
  'refreshToken',
  'accessToken',
  'secret',
  'gatewayResponse'
]);

const redact = (value) => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (REDACTED_KEYS.has(key) || /token|password|secret|authorization|cookie/i.test(key)) {
        return [key, '[REDACTED]'];
      }
      return [key, redact(item)];
    })
  );
};

// Helper to format log messages
const formatMessage = (level, message, meta = {}) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...redact(meta)
  };
  return JSON.stringify(logEntry);
};

// Write to file
const writeToFile = (filename, content) => {
  const filePath = path.join(logsDir, filename);
  fs.promises.appendFile(filePath, content + '\n', 'utf8').catch((error) => {
    console.error('Log write failed', error.message);
  });
};

// Logger methods
const logger = {
  error: (message, meta = {}) => {
    if (currentLevel >= LOG_LEVELS.ERROR) {
      const formatted = formatMessage('ERROR', message, meta);
      if (!IS_TEST) console.error(`❌ ${message}`, meta);
      writeToFile('error.log', formatted);
    }
  },

  warn: (message, meta = {}) => {
    if (currentLevel >= LOG_LEVELS.WARN) {
      const formatted = formatMessage('WARN', message, meta);
      if (!IS_TEST) console.warn(`⚠️ ${message}`, meta);
      writeToFile('warn.log', formatted);
    }
  },

  info: (message, meta = {}) => {
    if (currentLevel >= LOG_LEVELS.INFO) {
      const formatted = formatMessage('INFO', message, meta);
      if (!IS_PRODUCTION && !IS_TEST) console.log(`ℹ️ ${message}`, meta);
      if (!IS_PRODUCTION) writeToFile('info.log', formatted);
    }
  },

  debug: (message, meta = {}) => {
    if (currentLevel >= LOG_LEVELS.DEBUG) {
      const formatted = formatMessage('DEBUG', message, meta);
      if (!IS_PRODUCTION && !IS_TEST) console.debug(`🐛 ${message}`, meta);
      if (!IS_PRODUCTION) writeToFile('debug.log', formatted);
    }
  },

  audit: (message, meta = {}) => {
    const formatted = formatMessage('AUDIT', message, meta);
    if (!IS_PRODUCTION && !IS_TEST) console.log(`AUDIT ${message}`, redact(meta));
    writeToFile('audit.log', formatted);
  },

  // Request logging middleware
  requestLogger: (req, res, next) => {
    const start = Date.now();
    const { method, url } = req;

    res.on('finish', () => {
      const duration = Date.now() - start;
      const { statusCode } = res;
      const shouldLog = process.env.LOG_HTTP === 'true' || statusCode >= 400 || duration > 1500;

      if (!shouldLog) return;

      const log = statusCode >= 500 ? logger.error : statusCode >= 400 ? logger.warn : logger.info;
      log('Request completed', {
        requestId: req.requestId,
        method,
        url: req.originalUrl || url,
        statusCode,
        durationMs: duration,
        userId: req.user?.id || 'anonymous'
      });
    });

    next();
  },

  // Error logging middleware
  errorLogger: (err, req, res, next) => {
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      method: req.method,
      url: req.url,
      userId: req.user?.id || 'anonymous',
      ip: req.ip
    });
    next(err);
  }
};

module.exports = logger;
