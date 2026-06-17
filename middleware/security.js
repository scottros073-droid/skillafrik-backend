// filepath: backend/middleware/security.js
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { getAllowedOrigins } = require("../config/corsConfig");

const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.paystack.co", "wss:", "https:"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", "https://checkout.paystack.com"],
    },
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
});

const standardLimiterOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
};

const isE2E = process.env.E2E_EXPOSE_VERIFICATION_CODE === 'true';
const isTestMode = isE2E || process.env.NODE_ENV === 'test' || process.env.TEST === 'true';
const authRateLimit = isTestMode ? 60 : 5;
const signupRateLimit = isTestMode ? 100 : 20;
const forgotPasswordRateLimit = isTestMode ? 50 : 5;

const generalLimiter = rateLimit({
  ...standardLimiterOptions,
  windowMs: 15 * 60 * 1000,
  max: 900,
  skip: (req) => {
    const path = req.originalUrl?.split("?")[0] || req.path || "";
    return (
      req.method === "OPTIONS" ||
      path === "/health" ||
      path === "/api/health" ||
      /^\/api\/(auth|dashboard|jobs|local-jobs|marketplace|notifications)(\/|$)/.test(path)
    );
  },
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
});

const dashboardLimiter = rateLimit({
  ...standardLimiterOptions,
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: {
    success: false,
    message: "Too many dashboard requests, please try again later",
  },
});

const authLimiter = rateLimit({
  ...standardLimiterOptions,
  windowMs: 15 * 60 * 1000,
  max: authRateLimit,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "Too many login attempts, please try again in 15 minutes",
  },
});

const signupLimiter = rateLimit({
  ...standardLimiterOptions,
  windowMs: 10 * 60 * 1000,
  max: signupRateLimit,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).json({
    success: false,
    message: "Too many signup attempts. Please wait and try again.",
  }),
});

const forgotPasswordLimiter = rateLimit({
  ...standardLimiterOptions,
  windowMs: 60 * 60 * 1000,
  max: forgotPasswordRateLimit,
  message: {
    success: false,
    message: "Too many password reset requests, please try again later",
  },
});

const messageLimiter = rateLimit({
  ...standardLimiterOptions,
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: "Too many messages, please slow down",
  },
});

const paymentLimiter = rateLimit({
  ...standardLimiterOptions,
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many payment attempts, please try again later",
  },
});

const clientErrorLimiter = rateLimit({
  ...standardLimiterOptions,
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: "Too many client error reports",
  },
});

const aiLimiter = rateLimit({
  ...standardLimiterOptions,
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many AI requests, please try again in a minute",
  },
});

const sanitizeMongoValue = (value) => {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeMongoValue);

  Object.keys(value).forEach((key) => {
    if (key.startsWith("$") || key.includes(".")) {
      delete value[key];
      return;
    }
    value[key] = sanitizeMongoValue(value[key]);
  });

  return value;
};

const mongoSanitize = (req, res, next) => {
  sanitizeMongoValue(req.body);
  sanitizeMongoValue(req.query);
  sanitizeMongoValue(req.params);
  next();
};

const isTrustedOrigin = (origin) => {
  if (!origin) return true;
  return getAllowedOrigins().includes(origin.replace(/\/+$/u, ""));
};

const requireTrustedOrigin = (req, res, next) => {
  const origin = req.get("Origin");
  const referer = req.get("Referer");

  if (isTrustedOrigin(origin)) return next();
  if (!origin && referer) {
    try {
      if (isTrustedOrigin(new URL(referer).origin)) return next();
    } catch {}
  }

  return res.status(403).json({
    success: false,
    message: "Request origin is not allowed",
  });
};

const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];

  if (process.env.NODE_ENV === "development" || !process.env.REQUIRE_API_KEY) {
    return next();
  }

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({
      success: false,
      message: "Invalid API key",
    });
  }

  return next();
};

module.exports = {
  helmetConfig,
  generalLimiter,
  authLimiter,
  signupLimiter,
  forgotPasswordLimiter,
  messageLimiter,
  paymentLimiter,
  clientErrorLimiter,
  dashboardLimiter,
  aiLimiter,
  apiKeyMiddleware,
  mongoSanitize,
  requireTrustedOrigin,
};
