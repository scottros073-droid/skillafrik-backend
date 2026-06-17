/**
 * SECURE HEADERS MIDDLEWARE
 * ==========================
 * Adds critical security headers to all responses
 * - CSP: Content Security Policy
 * - X-Content-Type-Options: Prevents MIME-type sniffing
 * - X-Frame-Options: Prevents clickjacking
 * - X-XSS-Protection: Browser XSS protection
 * - Strict-Transport-Security: HSTS
 * - Referrer-Policy: Controls referrer information
 * - Permissions-Policy: Controls browser features
 */

const helmet = require('helmet');

const secureHeadersMiddleware = [
  // Use helmet for comprehensive security headers
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        frameSrc: ["'self'"],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: []
      }
    },
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true
    },
    frameGuard: {
      action: 'DENY'
    },
    referrerPolicy: {
      policy: 'no-referrer'
    }
  }),

  // Custom middleware to add additional headers
  (req, res, next) => {
    // Prevent MIME-type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Browser XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Permissions Policy (replaces Feature-Policy)
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    // Remove server identification
    res.removeHeader('X-Powered-By');
    
    next();
  }
];

module.exports = secureHeadersMiddleware;
