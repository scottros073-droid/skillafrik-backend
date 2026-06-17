// backend/middleware/rateLimit.js
const rateLimitStore = new Map();

const rateLimit = ({ windowMs = 60000, max = 100 } = {}) => {
  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const now = Date.now();
    const entry = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };

    if (entry.resetAt <= now) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    rateLimitStore.set(key, entry);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > max) {
      return res.status(429).json({
        success: false,
        statusCode: 429,
        message: 'Too many requests, please try again later.'
      });
    }

    next();
  };
};

// Specific rate limiters for auth endpoints
const loginRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }); // 5 attempts per 15 minutes
const forgotPasswordRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 3 }); // 3 requests per hour

module.exports = { rateLimit, loginRateLimit, forgotPasswordRateLimit };