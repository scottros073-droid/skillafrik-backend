/**
 * PRODUCTION-SAFE LOGGER
 * ========================
 * In production: Only logs errors to stderr
 * In development: Logs all messages to console
 * In test: Suppresses all logging
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_TEST = process.env.NODE_ENV === 'test';

const logger = {
  /**
   * Info logs - suppressed in production
   */
  info: (...args) => {
    if (IS_PRODUCTION || IS_TEST) return;
    console.log('[INFO]', ...args);
  },

  /**
   * Warn logs - shown in production (and dev), suppressed in test
   */
  warn: (...args) => {
    if (IS_TEST) return;
    console.warn('[WARN]', ...args);
  },

  /**
   * Error logs - ALWAYS shown (critical for production debugging)
   */
  error: (...args) => {
    console.error('[ERROR]', ...args);
  },

  /**
   * Success logs - suppressed in production
   */
  success: (...args) => {
    if (IS_PRODUCTION || IS_TEST) return;
    console.log('[✅ SUCCESS]', ...args);
  },

  /**
   * Debug logs - suppressed in production
   */
  debug: (...args) => {
    if (IS_PRODUCTION || IS_TEST) return;
    if (process.env.DEBUG) {
      console.log('[DEBUG]', ...args);
    }
  },

  /**
   * Request logs - minimal in production
   */
  request: (method, path, status, duration) => {
    if (IS_TEST) return;
    if (IS_PRODUCTION) {
      // Only log slow requests and errors in production
      if (status >= 400 || duration > 1000) {
        const log = status >= 500 ? console.error : console.warn;
        log(`[API] ${method} ${path} - ${status} (${duration}ms)`);
      }
    } else {
      console.log(`[API] ${method} ${path} - ${status} (${duration}ms)`);
    }
  },

  /**
   * Security logs - ALWAYS shown in production
   */
  security: (...args) => {
    console.error('[🔒 SECURITY]', ...args);
  }
};

module.exports = logger;
