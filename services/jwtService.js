// filepath: backend/services/jwtService.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Token configuration
const ACCESS_TOKEN_EXPIRY = '1h'; // 1 hour
const REFRESH_TOKEN_EXPIRY = '7d'; // 7 days

// Generate access token (short-lived)
const generateAccessToken = (userId, role = 'user') => {
  return jwt.sign(
    { id: String(userId), role },
    process.env.JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_EXPIRY,
      jwtid: crypto.randomBytes(16).toString('hex')
    }
  );
};

// Generate refresh token (long-lived)
const generateRefreshToken = (userId, role = 'user') => {
  return jwt.sign(
    { id: String(userId), role, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    {
      expiresIn: REFRESH_TOKEN_EXPIRY,
      jwtid: crypto.randomBytes(16).toString('hex')
    }
  );
};

// Verify access token
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// Generate token pair
const generateTokenPair = (userId, role = 'user') => {
  const accessToken = generateAccessToken(userId, role);
  const refreshToken = generateRefreshToken(userId, role);
  
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRY
  };
};

// Generate secure random token (for email verification, etc.)
const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

// Hash token for storage
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateTokenPair,
  generateSecureToken,
  hashToken,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY
};