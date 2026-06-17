const crypto = require('crypto');
const logger = require('../utils/logger');

const REQUEST_ID_HEADER = 'x-request-id';

const requestContext = (req, res, next) => {
  const incomingId = req.get(REQUEST_ID_HEADER);
  const requestId = incomingId && /^[a-zA-Z0-9._:-]{8,128}$/.test(incomingId)
    ? incomingId
    : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
};

const apiTiming = (req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const roundedMs = Math.round(durationMs);

    if (roundedMs >= Number(process.env.SLOW_API_MS || 1200)) {
      logger.warn('Slow API request', {
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs: roundedMs,
        userId: req.user?.id || req.user?._id || null,
        ip: req.ip
      });
    }
  });

  next();
};

const clientErrorReporter = (req, res) => {
  const body = req.body || {};
  logger.error('Frontend runtime error', {
    requestId: req.requestId,
    message: String(body.message || 'Unknown frontend error').slice(0, 500),
    stack: String(body.stack || '').slice(0, 2000),
    componentStack: String(body.componentStack || '').slice(0, 2000),
    route: String(body.route || '').slice(0, 300),
    userAgent: req.get('User-Agent'),
    ip: req.ip
  });

  res.status(202).json({ success: true });
};

module.exports = {
  requestContext,
  apiTiming,
  clientErrorReporter
};
