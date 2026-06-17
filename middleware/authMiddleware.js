// backend/middleware/authMiddleware.js

const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const logger = require("../utils/logger");
const { connectDatabase } = require("../utils/mongoConnectionManager");
const { getAccountAccessFailure } = require("../services/authPolicy");

const waitForDatabase = async (timeoutMs = 15000) => {
  if (mongoose.connection.readyState === 1) return true;

  const startedAt = Date.now();
  if (mongoose.connection.readyState === 0) {
    connectDatabase().catch((error) => {
      logger.error('Failed to wake database connection from auth middleware', { error: error?.message || error });
    });
  }

  while (Date.now() - startedAt < timeoutMs) {
    if (mongoose.connection.readyState === 1) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return mongoose.connection.readyState === 1;
};

const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Please log in",
      data: {}
    });
  }

  const role = req.user.userType || req.user.role;
  if (!allowedRoles.includes(role)) {
    return res.status(403).json({
      success: false,
      message: `Forbidden: ${allowedRoles.join(' or ')} role required`,
      data: {}
    });
  }

  return next();
};

/**
 * HARDENED JWT VALIDATION MIDDLEWARE
 * ===================================
 * 1. Validates JWT before ANY database operation
 * 2. Rejects malformed tokens early
 * 3. Validates ObjectId format before DB lookup
 * 4. Checks account status after retrieval
 * 5. Prevents auth bypass attempts
 */
const authMiddleware = async (req, res, next) => {
  try {
    // ===== STEP 1: EXTRACT & VALIDATE BEARER TOKEN =====
    // Prefer Authorization header but fall back to an accessToken cookie when available
    const authHeader = req.headers.authorization || req.headers.Authorization;

    let token = null;
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    // If Authorization header missing, check for accessToken cookie as a fallback
    if (!token && req.headers && typeof req.headers.cookie === 'string') {
      const cookieHeader = req.headers.cookie || '';
      const match = cookieHeader.match(/(?:^|; )accessToken=([^;]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    if (!token || typeof token !== 'string' || token.length === 0) {
      logger.warn('JWT extraction failed', { authorization: Boolean(authHeader), cookiePresent: Boolean(req.headers?.cookie), url: req.url, ip: req.ip });
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session. Please login again.',
        data: {}
      });
    }

    // ===== STEP 2: VALIDATE JWT_SECRET CONFIGURATION =====
    if (!process.env.JWT_SECRET) {
      logger.error('JWT_SECRET not configured', { ip: req.ip });
      return res.status(500).json({
        success: false,
        message: 'Server configuration error',
        data: {}
      });
    }

    // ===== STEP 3: VERIFY JWT SIGNATURE & EXPIRATION =====
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        logger.warn('JWT expired', { expiresAt: err.expiredAt, url: req.url, ip: req.ip });
        return res.status(401).json({
          success: false,
          message: "Invalid or expired session. Please login again.",
          data: {}
        });
      }

      logger.warn('JWT verification failed', { reason: err.name || err.message, url: req.url, ip: req.ip });
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session. Please login again.",
        data: {}
      });
    }

    // ===== STEP 4: VALIDATE JWT PAYLOAD STRUCTURE =====
    if (!decoded || !decoded.id || typeof decoded.id !== 'string') {
      logger.warn('Invalid JWT payload', { decodedId: decoded?.id, url: req.url, ip: req.ip });
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session. Please login again.",
        data: {}
      });
    }

    // ===== STEP 5: VALIDATE USERID FORMAT BEFORE DB LOOKUP =====
    const isAdminToken = decoded.id === 'admin-user-id';
    
    if (!isAdminToken && !mongoose.Types.ObjectId.isValid(decoded.id)) {
      logger.warn('JWT contains invalid ObjectId', { userId: decoded.id, url: req.url, ip: req.ip });
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session. Please login again.",
        data: {}
      });
    }

    // ===== STEP 6: RETRIEVE USER FROM DATABASE =====
    let user;
    try {
      if (isAdminToken) {
        user = {
          _id: 'admin-user-id',
          email: process.env.ADMIN_EMAIL,
          firstName: 'Admin',
          lastName: 'User',
          userType: 'admin',
          status: 'active'
        };
      } else {
        if (!(await waitForDatabase())) {
          logger.error('Database unavailable during auth middleware validation', {
            userId: decoded.id,
            url: req.url,
            ip: req.ip,
            readyState: mongoose.connection.readyState
          });
          return res.status(503).json({
            success: false,
            message: 'Server is waking up. Please try again in a moment.',
            data: {}
          });
        }

        // Use lean() for performance since we're only checking properties
        user = await User.findById(decoded.id)
          .select('-password')
          .lean();

        if (!user) {
          logger.warn('User not found after JWT validation', { userId: decoded.id, url: req.url, ip: req.ip });
          return res.status(401).json({
            success: false,
            message: "Invalid or expired session. Please login again.",
            data: {}
          });
        }
      }
    } catch (dbError) {
      logger.error('Database error during auth validation', {
        error: dbError.message,
        userId: decoded.id,
        url: req.url,
        ip: req.ip
      });
      return res.status(500).json({
        success: false,
        message: 'Authentication failed. Please try again.',
        data: {}
      });
    }

    // ===== STEP 7: VALIDATE ACCOUNT STATUS =====
    const accountFailure = getAccountAccessFailure(user, { requireVerified: false });
    if (accountFailure) {
      logger.warn('Ineligible account access attempt', {
        userId: user._id,
        status: user.status,
        verified: user.verified,
        url: req.url,
        ip: req.ip
      });
      return res.status(accountFailure.status).json({
        success: false,
        message: accountFailure.message,
        data: accountFailure.data
      });
    }

    // ===== STEP 8: ATTACH USER TO REQUEST & PROCEED =====
    req.user = user;
    req.user.id = String(user._id);
    req.user.role = user.userType; // Add role for frontend compatibility
    
    next();
  } catch (err) {
    logger.error('Auth middleware unhandled error', {
      error: err.message,
      stack: err.stack,
      ip: req.ip
    });
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid token",
      data: {}
    });
  }
};

const adminMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Please log in",
      data: {}
    });
  }

  if (req.user.userType !== 'admin') {
    logger.warn('Non-admin attempted admin access', { userId: req.user._id });
    return res.status(403).json({
      success: false,
      message: "Forbidden: Admin access required",
      data: {}
    });
  }
  next();
};

module.exports = { authMiddleware, adminMiddleware, requireRole };

