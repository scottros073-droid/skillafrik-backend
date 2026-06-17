// backend/controllers/authController.js

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const logger = require('../utils/logger');
const jwtService = require('../services/jwtService');
const emailService = require('../services/emailService');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Gamification = require('../models/Gamification');
const RefreshToken = require('../models/RefreshToken');
const { connectDatabase } = require('../utils/mongoConnectionManager');
const { getAccountAccessFailure } = require('../services/authPolicy');

// Initialize Google OAuth2Client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const REFRESH_TOKEN_COOKIE = 'refreshToken';
const ACCESS_TOKEN_COOKIE = 'accessToken';
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACCESS_TOKEN_MAX_AGE = 60 * 60 * 1000; // 1 hour
const ALLOWED_PUBLIC_ROLES = new Set(['client', 'freelancer']);
const AUTH_DB_READY_TIMEOUT_MS = Number(process.env.AUTH_DB_READY_TIMEOUT_MS || 3000);
const AUTH_SIDE_EFFECT_TIMEOUT_MS = Number(process.env.AUTH_SIDE_EFFECT_TIMEOUT_MS || 5000);
const AUTH_REFRESH_TOKEN_TIMEOUT_MS = Number(process.env.AUTH_REFRESH_TOKEN_TIMEOUT_MS || 5000);
const AUTH_EMAIL_TIMEOUT_MS = Number(process.env.AUTH_EMAIL_TIMEOUT_MS || 10000);

const normalizePublicRole = (role) => {
  const normalized = String(role || '').trim().toLowerCase();
  return ALLOWED_PUBLIC_ROLES.has(normalized) ? normalized : 'freelancer';
};

const createVerificationCode = () => Math.floor(100000 + Math.random() * 900000).toString();
const isVerificationCodeExposed = () => process.env.E2E_EXPOSE_VERIFICATION_CODE === 'true';

const withTimeout = (promise, timeoutMs, label) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
};

const runDetached = (label, task) => {
  const runner = typeof setImmediate === 'function' ? setImmediate : (fn) => setTimeout(fn, 0);
  runner(() => {
    Promise.resolve()
      .then(task)
      .catch((error) => {
        logger.error(`${label} failed`, { error: error?.message || error });
      });
  });
};

const sendVerificationEmailAsync = (user, req) => {
  if (isVerificationCodeExposed()) {
    logger.info('⏭️  Skipping verification email during E2E run', {
      userId: user._id,
      email: user.email,
      verificationCode: user.verificationToken,
      ip: req.ip
    });
    return;
  }

  runDetached('Verification email dispatch', async () => {
    logger.info('📧 Starting async email dispatch', { 
      userId: user._id, 
      email: user.email,
      verificationCode: user.verificationToken 
    });
    
    const emailResult = await withTimeout(
      emailService.sendVerificationEmail(user.email, user.verificationToken),
      AUTH_EMAIL_TIMEOUT_MS,
      'Verification email dispatch'
    );
    
    if (!emailResult.success) {
      logger.error('❌ Verification email failed to send', {
        userId: user._id,
        email: user.email,
        error: emailResult.error,
        ip: req.ip
      });
    } else {
      logger.info('✅ Verification email sent', {
        userId: user._id,
        email: user.email,
        messageId: emailResult.messageId,
        ip: req.ip
      });
    }
  });
};

const buildVerificationData = (user, verificationCode, extra = {}) => ({
  ...extra,
  email: user.email,
  ...(isVerificationCodeExposed() ? { verificationCode } : {})
});

const buildVerifiedResponse = async (req, res, user, message, extraData = {}) => {
  const responseUser = formatAuthUserPayload(user);
  const data = {
    ...extraData,
    verified: true,
    user: responseUser
  };

  try {
    const tokens = await issueTokenPair(req, res, user._id, user.userType || 'user');
    return res.json({
      success: true,
      message,
      token: tokens.accessToken,
      user: responseUser,
      data: {
        ...data,
        token: tokens.accessToken,
        accessToken: tokens.accessToken
      }
    });
  } catch (sessionError) {
    logger.warn('Email verified but session creation failed', {
      userId: user._id,
      error: sessionError.message,
      ip: req.ip
    });

    clearRefreshCookie(res);
    return res.json({
      success: true,
      message,
      user: responseUser,
      data
    });
  }
};

const regenerateVerificationToken = async (user) => {
  const verificationCode = createVerificationCode();
  const verificationTokenExpiry = new Date(Date.now() + VERIFICATION_CODE_TTL_MS);
  await User.updateOne(
    { _id: user._id, verified: false },
    {
      $set: {
        verificationToken: verificationCode,
        verificationTokenExpiry
      }
    }
  );

  user.verificationToken = verificationCode;
  user.verificationTokenExpiry = verificationTokenExpiry;
  return verificationCode;
};

// Global guard for RefreshToken operations
const validateRefreshTokenUserId = (userId) => {
  const normalizedUserId = String(userId);

  // Admin users NEVER use database operations
  if (normalizedUserId === 'admin-user-id') {
    return { valid: false, reason: 'admin_user' };
  }

  // Must be valid ObjectId for database operations
  if (!mongoose.Types.ObjectId.isValid(normalizedUserId)) {
    return { valid: false, reason: 'invalid_objectid' };
  }

  return { valid: true, userId: normalizedUserId };
};

const waitForDatabase = async (timeoutMs = AUTH_DB_READY_TIMEOUT_MS) => {
  if (mongoose.connection.readyState === 1) return true;

  const startedAt = Date.now();
  if (mongoose.connection.readyState === 0) {
    connectDatabase().catch((error) => {
      logger.error('Failed to wake database connection from auth controller', { error: error?.message || error });
    });
  }

  while (Date.now() - startedAt < timeoutMs) {
    if (mongoose.connection.readyState === 1) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return mongoose.connection.readyState === 1;
};

const requireDatabaseReady = async (res, action) => {
  const ready = await waitForDatabase();
  if (ready) return true;

  logger.error('Database unavailable during auth action', {
    action,
    readyState: mongoose.connection.readyState
  });

  safeJsonResponse(res, 503, false, 'Server is waking up. Please try again in a moment.');
  return false;
};

const getCookieOptions = (req = {}, maxAge = REFRESH_TOKEN_MAX_AGE) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const isSecureRequest = Boolean(req.secure || forwardedProto === 'https');
  const hostHeader = String(req.headers?.host || '').toLowerCase();
  const isLocalHost = /(^|:)localhost(:|$)|(^|:)127\.0\.0\.1(:|$)/.test(hostHeader);

  // For localhost (including Vite proxy on 5173): use 'lax' to allow same-site requests through proxy
  // For production: use 'none' (requires secure: true) for cross-site capability
  const sameSite = isLocalHost ? 'lax' : 'none';
  // Browsers require `Secure` when `SameSite=None` — enforce secure for production non-localhost
  const secure = isProduction && !isLocalHost ? true : false;

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge
  };
};

const getCookie = (req, name) => {
  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(cookie => cookie.trim().split('='));
  const cookiePair = cookies.find(([key]) => key === name);
  return cookiePair ? decodeURIComponent(cookiePair[1] || '') : null;
};

// Probe endpoint to allow safe E2E checks for cookie presence without triggering 401s
exports.refreshProbe = async (req, res) => {
  try {
    const hasCookie = Boolean(getCookie(req, REFRESH_TOKEN_COOKIE));
    return res.json({ success: true, hasCookie });
  } catch (err) {
    logger.error('Refresh probe failed', { error: err.message, ip: req.ip });
    return res.json({ success: false, hasCookie: false });
  }
};

const setRefreshCookie = (res, token, req = {}) => {
  res.cookie(REFRESH_TOKEN_COOKIE, token, getCookieOptions(req, REFRESH_TOKEN_MAX_AGE));
};

const setAccessCookie = (res, token, req = {}) => {
  res.cookie(ACCESS_TOKEN_COOKIE, token, getCookieOptions(req, ACCESS_TOKEN_MAX_AGE));
};

const clearRefreshCookie = (res, req = {}) => {
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    ...getCookieOptions(req, REFRESH_TOKEN_MAX_AGE),
    maxAge: 0
  });
};

const clearAccessCookie = (res, req = {}) => {
  res.clearCookie(ACCESS_TOKEN_COOKIE, {
    ...getCookieOptions(req, ACCESS_TOKEN_MAX_AGE),
    maxAge: 0
  });
};

const formatAuthUserPayload = (user) => {
  if (!user) return null;

  const json = typeof user.toJSON === 'function' ? user.toJSON() : user;
  const firstName = json.firstName || '';
  const lastName = json.lastName || '';

  return {
    _id: json._id,
    id: json._id,
    email: json.email,
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' '),
    role: json.userType || json.role || 'freelancer',
    userType: json.userType || json.role || 'freelancer',
    avatar: json.avatar || '',
    title: json.title || '',
    bio: json.bio || '',
    purpose: json.purpose || '',
    location: json.purpose || '',
    skills: Array.isArray(json.skills) ? json.skills : [],
    hourlyRate: json.hourlyRate || 0,
    rate: json.hourlyRate || 0,
    verified: Boolean(json.verified),
    isVerified: Boolean(json.verified),
    isPremium: Boolean(json.isPremium),
    isTopUser: Boolean(json.isTopUser),
    authProvider: json.authProvider || 'email'
  };
};

const persistRefreshTokenAsync = (req, userId, role, refreshToken, expiresAt) => {
  const normalizedUserId = String(userId);
  const validation = validateRefreshTokenUserId(normalizedUserId);

  if (validation.valid) {
    runDetached('Refresh token persistence', async () => {
      try {
        const result = await withTimeout(
          RefreshToken.createSafeToken(
            jwtService.hashToken(refreshToken),
            validation.userId,
            expiresAt,
            { userAgent: req.headers['user-agent'], ipAddress: req.ip }
          ),
          AUTH_REFRESH_TOKEN_TIMEOUT_MS,
          'Refresh token persistence'
        );
        if (!result.success) throw new Error(result.message);
      } catch (dbError) {
        logger.error('Failed to persist refresh token', {
          error: dbError.message,
          userId: validation.userId,
          ip: req.ip
        });
      }
    });
    return true;
  }

  if (validation.reason === 'invalid_objectid') {
    logger.warn('Skipping refresh token storage for invalid userId', {
      userId: normalizedUserId,
      role,
      ip: req.ip
    });
    return false;
  }

  return true;
};

const issueTokenPair = async (req, res, userId, role = 'user') => {
  const normalizedUserId = String(userId);
  const isAdminUser = normalizedUserId === 'admin-user-id';
  const validation = validateRefreshTokenUserId(normalizedUserId);

  if (!validation.valid && !isAdminUser) {
    if (validation.reason === 'invalid_objectid') {
      logger.warn('Skipping refresh token storage for invalid userId', {
        userId: normalizedUserId,
        role,
        ip: req.ip
      });
      throw new Error('Invalid user session identifier');
    }
    throw new Error('Invalid user session identifier');
  }

  const tokens = jwtService.generateTokenPair(normalizedUserId, role);
  setAccessCookie(res, tokens.accessToken, req);

  if (isAdminUser) {
    logger.info('Issuing admin token pair without refresh persistence', {
      userId: normalizedUserId,
      role,
      ip: req.ip
    });
    setRefreshCookie(res, tokens.refreshToken, req);
    return tokens;
  }

  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE);
  let attempt = 0;

  while (attempt < 3) {
    attempt += 1;
    logger.info('Attempting refresh token persistence', {
      userId: normalizedUserId,
      role,
      attempt,
      ip: req.ip
    });

    const result = await withTimeout(
      RefreshToken.createSafeToken(
        jwtService.hashToken(tokens.refreshToken),
        validation.userId,
        expiresAt,
        { userAgent: req.headers['user-agent'], ipAddress: req.ip }
      ),
      AUTH_REFRESH_TOKEN_TIMEOUT_MS,
      'Refresh token persistence'
    );

    logger.info('Refresh token persistence result', {
      userId: normalizedUserId,
      role,
      attempt,
      success: result.success,
      message: result.message,
      ip: req.ip
    });

    if (result.success) {
      setRefreshCookie(res, tokens.refreshToken, req);
      return tokens;
    }

    const duplicateError = /duplicate/i.test(result.message || '');
    if (!duplicateError) {
      throw new Error(result.message || 'Refresh token persistence failed');
    }

    if (attempt < 3) {
      logger.warn('Duplicate refresh token collision detected. Retrying token generation.', {
        userId: normalizedUserId,
        attempt: attempt + 1,
        ip: req.ip
      });
      continue;
    }

    throw new Error(result.message || 'Refresh token persistence failed after retries');
  }

  throw new Error('Unable to persist refresh token after retries');
};

const issueTokenPairWithPersistence = async (req, res, userId, role = 'user') => {
  return issueTokenPair(req, res, userId, role);
};

const sendUnverifiedResponse = async (req, res, user, message = 'Please verify your email before logging in.') => {
  let verificationCode = user.verificationToken;
  if (!user.verificationToken || !user.verificationTokenExpiry || user.verificationTokenExpiry <= new Date()) {
    verificationCode = await regenerateVerificationToken(user);
    sendVerificationEmailAsync(user, req);
  }

  logger.warn('Login attempt blocked - email not verified', {
    userId: user._id,
    email: String(user.email || '').substring(0, 3) + '***',
    ip: req.ip
  });

  return safeJsonResponse(res, 403, false, message, buildVerificationData(user, verificationCode, {
    requiresVerification: true
  }));
};

const markUserVerifiedByToken = async (verificationToken, email = null) => {
  const verifiedAt = new Date();
  const query = {
    verificationToken,
    verified: false,
    verificationTokenExpiry: { $gt: verifiedAt }
  };
  if (email) query.email = email;

  return User.findOneAndUpdate(
    query,
    {
      $set: {
        verified: true,
        verificationDate: verifiedAt
      },
      $unset: {
        verificationToken: '',
        verificationTokenExpiry: ''
      }
    },
    { new: true }
  );
};

const findVerificationCandidate = async (verificationToken, email = null) => {
  const query = { verificationToken };
  if (email) query.email = email;
  return User.findOne(query);
};

const safeJsonResponse = (res, status, success, message, data = {}) => {
  return res.status(status).json({ success, message, data });
};

const provisionUserResourcesAsync = (userId) => {
  runDetached('Signup resource provisioning', async () => {
    const wallet = await withTimeout(
      Wallet.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ),
      AUTH_SIDE_EFFECT_TIMEOUT_MS,
      'Wallet provisioning'
    );

    await withTimeout(
      Gamification.updateOne(
        { userId },
        { $setOnInsert: { userId } },
        { upsert: true, setDefaultsOnInsert: true }
      ),
      AUTH_SIDE_EFFECT_TIMEOUT_MS,
      'Gamification provisioning'
    );

    if (wallet?._id) {
      await withTimeout(
        User.updateOne({ _id: userId, wallet: { $in: [null, undefined] } }, { $set: { wallet: wallet._id } }),
        AUTH_SIDE_EFFECT_TIMEOUT_MS,
        'User wallet linkage'
      );
    }
  });
};

const recordLoginAsync = (userId) => {
  runDetached('Login metadata update', async () => {
    await withTimeout(
      User.updateOne({ _id: userId }, { $set: { lastLogin: new Date(), lastActive: new Date() } }),
      AUTH_SIDE_EFFECT_TIMEOUT_MS,
      'Login metadata update'
    );
  });
};

exports.signup = async (req, res) => {
  logger.info('Signup request received', {
    path: req.path,
    method: req.method,
    ip: req.ip,
    body: {
      email: String(req.body?.email || req.validated?.email || '').slice(0, 50),
      firstName: String(req.body?.firstName || req.validated?.firstName || '').slice(0, 25),
      lastName: String(req.body?.lastName || req.validated?.lastName || '').slice(0, 25),
      userType: String(req.body?.userType || req.validated?.userType || req.body?.role || req.validated?.role || '')
    }
  });

  try {
    if (!(await requireDatabaseReady(res, 'signup'))) return;

    const payload = req.validated || req.body || {};
    let { email, password, firstName, lastName, userType, name } = payload;

    const normalize = (value) => (typeof value === 'string' ? value.trim() : '');
    const isValidEmail = (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

    // Step 1: Normalize email using toLowerCase().trim()
    email = normalize(email).toLowerCase();
    password = normalize(password);
    firstName = normalize(firstName);
    lastName = normalize(lastName);

    if (name && (!firstName || !lastName)) {
      const nameParts = normalize(name).split(/\s+/).filter(Boolean);
      firstName = firstName || nameParts.shift() || '';
      lastName = lastName || nameParts.join(' ');
    }

    if (!firstName) {
      return safeJsonResponse(res, 400, false, 'Missing required fields: firstName');
    }

    if (!lastName) {
      return safeJsonResponse(res, 400, false, 'Missing required fields: lastName');
    }

    if (!email) {
      return safeJsonResponse(res, 400, false, 'Missing required fields: email');
    }

    // Step 2: Validate that password field is NOT empty before saving
    if (!password || typeof password !== 'string') {
      return safeJsonResponse(res, 400, false, 'Missing required fields: password');
    }

    if (!isValidEmail(email)) {
      return safeJsonResponse(res, 400, false, 'Invalid input data: email is not valid');
    }

    if (password.length < 8) {
      return safeJsonResponse(res, 400, false, 'Invalid input data: password must be at least 8 characters long');
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      logger.warn('Signup blocked: email already in use', {
        email,
        ip: req.ip
      });
      return safeJsonResponse(res, 409, false, 'Account exists. Please log in.');
    }

    const role = normalizePublicRole(userType || payload.role);

    logger.info('Creating new user record', {
      email,
      firstName,
      lastName,
      role,
      ip: req.ip
    });

    // Step 3: Save user with normalized email and password (will be hashed by User model pre-save hook)
    const user = await User.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email,
      password,
      userType: role,
      role: role === 'admin' ? 'admin' : 'user',
      verified: true
    });

    // Debug: Log password storage confirmation
    logger.info('Password storage debug', {
      userId: user._id,
      email: user.email,
      passwordProvided: !!password,
      passwordLength: password ? password.length : 0,
      userHasPassword: !!user.password,
      userPasswordLength: user.password ? user.password.length : 0,
      passwordIsHashed: user.password && user.password.startsWith('$2b$'),
      passwordFormat: user.password ? (user.password.startsWith('$2b$') ? 'bcrypt' : 'plain') : 'none',
      ip: req.ip
    });

    // Step 4: Log saved user email and password existence (NOT password itself)
    logger.info('User created successfully', {
      userId: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      hasPassword: !!user.password && typeof user.password === 'string',
      passwordLength: user.password ? user.password.length : 0,
      ip: req.ip
    });

    provisionUserResourcesAsync(user._id);

    logger.info('User record persisted successfully', {
      userId: user._id,
      email: user.email,
      ip: req.ip
    });

    const tokens = await issueTokenPair(req, res, user._id, user.userType || 'user');
    if (!tokens || !tokens.accessToken) {
      logger.error('Signup session initialization failed', {
        userId: user._id,
        email: user.email,
        ip: req.ip
      });
      return safeJsonResponse(res, 500, false, 'Signup succeeded but session initialization failed. Please login.');
    }

    const responseUser = formatAuthUserPayload(user);

    logger.info('✅ User registration successful', {
      userId: user._id,
      email: user.email,
      userType: role,
      verified: true
    });

    return res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      token: tokens.accessToken,
      user: responseUser,
      data: {
        user: responseUser,
        token: tokens.accessToken,
        accessToken: tokens.accessToken,
      }
    });
  } catch (err) {
    logger.error('Signup error', { error: err.message, ip: req.ip, stack: err.stack });

    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return safeJsonResponse(res, 400, false, `Invalid input data: ${messages.join(', ')}`);
    }

    if (err.code === 11000 || err.name === 'MongoServerError') {
      return safeJsonResponse(res, 409, false, 'Email already exists');
    }

    console.error('SIGNUP ERROR (UNHANDLED):', err.message, err.stack);
    logger.error('Signup unhandled error', { error: err.message, ip: req.ip });
    // Never expose stack traces
    return safeJsonResponse(res, 500, false, 'Registration failed. Please try again.');
  }
};

exports.login = async (req, res) => {
  try {
    const loginData = req.validated || req.body || {};
    const { email, password } = loginData;

    // ===== VALIDATION =====
    if (!email || !password) {
      console.warn('LOGIN: Missing email or password');
      return safeJsonResponse(res, 400, false, 'Email and password are required');
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      console.warn('LOGIN: Email or password not string');
      return safeJsonResponse(res, 400, false, 'Email and password are required');
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      console.warn('LOGIN: Normalized email is empty');
      return safeJsonResponse(res, 400, false, 'Email and password are required');
    }

    // ===== ADMIN LOGIN CHECK =====
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (adminEmail && adminPassword && normalizedEmail === adminEmail.toLowerCase().trim() && password === adminPassword) {
      try {
        const adminUser = {
          _id: 'admin-user-id',
          email: normalizedEmail,
          firstName: 'Admin',
          lastName: 'User',
          role: 'admin',
          userType: 'admin'
        };

        const tokens = await issueTokenPair(req, res, adminUser._id, 'admin');

        logger.info('Admin login successful', { email: normalizedEmail.substring(0, 3) + '***', ip: req.ip });

        return res.status(200).json({ success: true, token: tokens.accessToken, user: adminUser });
      } catch (adminError) {
        console.error('LOGIN: Admin token generation failed', adminError.message);
        logger.error('Admin login error - token generation failed', { error: adminError.message, ip: req.ip });
        return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
      }
    }

    if (!(await requireDatabaseReady(res, 'login'))) return;

    // ===== USER LOGIN CHECK =====
    let user;
    try {
      user = await User.findOne({ email: normalizedEmail });
    } catch (dbError) {
      console.error('LOGIN: Database lookup failed', dbError.message);
      logger.error('Login database error', { error: dbError.message, ip: req.ip });
      return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }

    if (!user) {
      console.warn('LOGIN: User not found');
      logger.warn('Login attempt failed - user not found', { email: normalizedEmail.substring(0, 3) + '***', ip: req.ip });
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    // ===== PASSWORD VALIDATION =====
    if (!user.password || typeof user.password !== 'string') {
      console.warn('LOGIN: User has invalid password record');
      logger.warn('Login attempt failed - invalid password record', { userId: user._id, email: normalizedEmail.substring(0, 3) + '***', ip: req.ip });
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // ===== BCRYPT COMPARE =====
    let isMatch;
    try {
      isMatch = await bcrypt.compare(password, user.password);
    } catch (bcryptError) {
      console.error('LOGIN: Bcrypt compare failed', bcryptError.message);
      logger.error('Login bcrypt error', { error: bcryptError.message, userId: user._id, ip: req.ip });
      return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }

    if (!isMatch) {
      console.warn('LOGIN: Password does not match');
      logger.warn('Login attempt failed - invalid password', { userId: user._id, email: normalizedEmail.substring(0, 3) + '***', ip: req.ip });
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    const accountFailure = getAccountAccessFailure(user, { requireVerified: false });
    if (accountFailure) {
      logger.warn('Login attempt failed - account not eligible', {
        userId: user._id,
        email: normalizedEmail.substring(0, 3) + '***',
        status: user.status,
        ip: req.ip
      });
      return safeJsonResponse(res, accountFailure.status, false, accountFailure.message, accountFailure.data);
    }

    recordLoginAsync(user._id);

    // ===== ISSUE TOKENS =====
    let tokens;
    try {
      tokens = await issueTokenPair(req, res, user._id, user.userType || 'user');
    } catch (tokenError) {
      console.error('LOGIN: Token generation failed', tokenError.message);
      logger.error('Login token generation error', { error: tokenError.message, userId: user._id, ip: req.ip });
      return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }

    const responseUser = formatAuthUserPayload(user);

    logger.info('Login successful', { userId: user._id, userType: user.userType, ip: req.ip });

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token: tokens.accessToken,
      user: responseUser,
      data: {
        token: tokens.accessToken,
        accessToken: tokens.accessToken,
        user: responseUser
      }
    });
  } catch (error) {
    console.error('LOGIN ERROR (UNHANDLED):', error.message, error.stack);
    logger.error('Login unhandled error', { error: error.message, ip: req.ip });
    // Never expose stack traces in responses
    return res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.'
    });
  }
};

exports.getCurrentUser = async (req, res) => {
  try {
    // If no user is attached by middleware, return a safe 200 with null user.
    if (!req.user) {
      return res.json({ success: true, user: null });
    }

    if (req.user._id !== 'admin-user-id' && !(await requireDatabaseReady(res, 'getCurrentUser'))) return;

    const user = req.user._id === 'admin-user-id'
      ? {
          _id: 'admin-user-id',
          email: process.env.ADMIN_EMAIL,
          firstName: 'Admin',
          lastName: 'User',
          userType: 'admin',
          role: 'admin',
          status: 'active'
        }
      : await User.findById(req.user._id)
          .populate('wallet')
          .select('-password');

    if (!user) {
      return safeJsonResponse(res, 404, false, 'User not found');
    }

    // Ensure role is included for frontend compatibility
    const userResponse = user._id === 'admin-user-id' ? user : user.toJSON();
    if (userResponse !== user) {
      userResponse.role = user.userType;
    }

    return res.json({
      success: true,
      user: userResponse
    });
  } catch (err) {
    logger.error('Get user error', { error: err.message, ip: req.ip });
    return safeJsonResponse(res, 500, false, 'Failed to get user');
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('firstName lastName email role status createdAt');
    const formattedUsers = users.map(user => ({
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt
    }));
    return res.json({ success: true, message: 'Users retrieved', data: formattedUsers });
  } catch (err) {
    logger.error('Get users error', { error: err.message, ip: req.ip });
    return safeJsonResponse(res, 500, false, 'Failed to get users', []);
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    if (!(await requireDatabaseReady(res, 'verifyEmail'))) return;

    const { token } = req.params;
    const verificationToken = String(token || '').trim();
    if (!verificationToken) {
      return safeJsonResponse(res, 400, false, 'Verification token is required');
    }

    const user = await markUserVerifiedByToken(verificationToken);

    if (!user) {
      const candidate = await findVerificationCandidate(verificationToken);
      if (candidate?.verified) {
        return buildVerifiedResponse(req, res, candidate, 'Email is already verified', { alreadyVerified: true });
      }
      if (candidate) {
        return safeJsonResponse(res, 400, false, 'Verification link expired. Please request a new verification email.', {
          requiresVerification: true,
          email: candidate.email
        });
      }
      return safeJsonResponse(res, 400, false, 'Invalid verification link. Please request a new verification email.');
    }

    return buildVerifiedResponse(req, res, user, 'Email verified successfully');
  } catch (err) {
    logger.error('Verify email error', { error: err.message, ip: req.ip });
    return safeJsonResponse(res, 400, false, 'Email verification failed');
  }
};

exports.verifyEmailCode = async (req, res) => {
  try {
    if (!(await requireDatabaseReady(res, 'verifyEmailCode'))) return;

    const { token, code, email } = req.body || {};
    const verificationToken = String(token || code || '').trim();
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : null;

    if (!verificationToken) {
      return safeJsonResponse(res, 400, false, 'Verification code is required');
    }

    const user = await markUserVerifiedByToken(verificationToken, normalizedEmail);
    if (!user) {
      const candidate = await findVerificationCandidate(verificationToken, normalizedEmail);
      if (candidate?.verified) {
        return buildVerifiedResponse(req, res, candidate, 'Email is already verified', { alreadyVerified: true });
      }
      if (candidate) {
        return safeJsonResponse(res, 400, false, 'Verification code expired. Please request a new verification email.', {
          requiresVerification: true,
          email: candidate.email
        });
      }
      return safeJsonResponse(res, 400, false, 'Invalid verification code. Please request a new verification email.');
    }

    return buildVerifiedResponse(req, res, user, 'Email verified successfully');
  } catch (err) {
    logger.error('Verify email code error', { error: err.message, ip: req.ip });
    return safeJsonResponse(res, 400, false, 'Email verification failed');
  }
};

exports.resendVerification = async (req, res) => {
  try {
    if (!(await requireDatabaseReady(res, 'resendVerification'))) return;

    const { email } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!normalizedEmail) {
      return safeJsonResponse(res, 400, false, 'Email is required');
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.json({
        success: true,
        message: 'If this email belongs to an unverified account, a new verification code has been sent.',
        data: {}
      });
    }

    if (user.verified) {
      return res.json({ success: true, message: 'Email is already verified.', data: { alreadyVerified: true } });
    }

    const verificationCode = await regenerateVerificationToken(user);
    sendVerificationEmailAsync(user, req);

    return res.json({
      success: true,
      message: 'Verification email sent. Please check your inbox.',
      data: buildVerificationData(user, verificationCode)
    });
  } catch (err) {
    logger.error('Resend verification error', { error: err.message, ip: req.ip });
    return safeJsonResponse(res, 500, false, 'Failed to resend verification email');
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    if (!(await requireDatabaseReady(res, 'verifyOtp'))) return;

    const { userId, code } = req.body;
    if (!userId || !code) {
      return safeJsonResponse(res, 400, false, 'User ID and code are required');
    }

    const user = await User.findOneAndUpdate(
      {
        _id: userId,
        verificationToken: String(code).trim(),
        verified: false,
        verificationTokenExpiry: { $gt: new Date() }
      },
      {
        $set: {
          verified: true,
          verificationDate: new Date()
        },
        $unset: {
          verificationToken: '',
          verificationTokenExpiry: ''
        }
      },
      { new: true }
    );

    if (!user) {
      const candidate = await User.findById(userId);
      if (!candidate) {
        return safeJsonResponse(res, 404, false, 'User not found');
      }
      if (candidate.verified) {
        return buildVerifiedResponse(req, res, candidate, 'Email is already verified', { alreadyVerified: true });
      }
      if (candidate.verificationToken === String(code).trim()) {
        return safeJsonResponse(res, 400, false, 'Verification code expired. Please request a new verification email.', {
          requiresVerification: true,
          email: candidate.email
        });
      }
      return safeJsonResponse(res, 400, false, 'Invalid verification code');
    }

    return buildVerifiedResponse(req, res, user, 'OTP verified successfully');
  } catch (err) {
    logger.error('Verify OTP error', { error: err.message, ip: req.ip });
    return safeJsonResponse(res, 500, false, 'OTP verification failed');
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    if (!(await requireDatabaseReady(res, 'forgotPassword'))) return;

    const { email } = req.body;
    if (!email) {
      return safeJsonResponse(res, 400, false, 'Invalid email');
    }

    const normalizedEmail = email.toLowerCase().trim();
    
    // Validate email format
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    if (!isValidEmail) {
      return safeJsonResponse(res, 400, false, 'Invalid email');
    }

    const user = await User.findOne({ email: normalizedEmail });
    
    if (!user) {
      // Don't reveal if email exists or not for security
      logger.info('🔐 Forgot password request for non-existent email', { email: normalizedEmail, ip: req.ip });
      return res.json({
        success: true,
        message: 'If an account exists for this email, a reset link has been sent.',
        data: {}
      });
    }

    // Generate reset token
    const resetToken = jwtService.generateSecureToken(32);
    const hashedToken = jwtService.hashToken(resetToken);
    const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    logger.info('🔐 Generating password reset token', { 
      userId: user._id, 
      email: user.email,
      tokenExpiresAt: tokenExpiry.toISOString(),
      ip: req.ip 
    });
    
    // Save token + expiry to user
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = tokenExpiry;
    await user.save();

    // Send email using nodemailer
    try {
      logger.info('📧 Attempting to send password reset email', { userId: user._id, email: user.email });
      const emailResult = await emailService.sendPasswordResetEmail(user.email, resetToken);
      
      if (emailResult.success) {
        logger.info('✅ Password reset email sent successfully', { userId: user._id, email: user.email, ip: req.ip });
        return res.json({
          success: true,
          message: 'Password reset email sent successfully. Please check your email.',
          data: {}
        });
      } else {
        logger.error('❌ Password reset email failed to send', { 
          error: emailResult.error,
          userId: user._id,
          email: user.email,
          ip: req.ip
        });
        
        // Clear tokens on email failure
        user.resetPasswordToken = null;
        user.resetPasswordExpires = null;
        await user.save();
        
        return safeJsonResponse(res, 500, false, 'Failed to send email. Please try again later.');
      }
    } catch (emailError) {
      logger.error('❌ Unexpected error sending password reset email', {
        error: emailError.message || emailError,
        errorCode: emailError.code,
        userId: user._id,
        email: user.email,
        ip: req.ip
      });
      
      // Clear tokens on error
      user.resetPasswordToken = null;
      user.resetPasswordExpires = null;
      await user.save();
      
      return safeJsonResponse(res, 500, false, 'Failed to send email. Please try again later.');
    }
  } catch (err) {
    logger.error('Forgot password error', { error: err.message, ip: req.ip });
    return safeJsonResponse(res, 500, false, 'Failed to process forgot password request');
  }
};

exports.resetPassword = async (req, res) => {
  try {
    if (!(await requireDatabaseReady(res, 'resetPassword'))) return;

    const { token } = req.params;
    const { password } = req.body;
    
    if (!password) {
      logger.warn('🔐 Reset password attempt without password field', { ip: req.ip });
      return safeJsonResponse(res, 400, false, 'Invalid password');
    }

    if (typeof password !== 'string' || password.trim().length < 8) {
      logger.warn('🔐 Reset password attempt with weak password', { 
        passwordLength: password ? password.length : 0,
        ip: req.ip 
      });
      return safeJsonResponse(res, 400, false, 'Invalid password');
    }

    // Validate token format (should be 64 chars hex after hashing)
    if (!token || token.length < 32) {
      logger.warn('🔐 Reset password attempt with invalid token format', { tokenLength: token?.length, ip: req.ip });
      return safeJsonResponse(res, 400, false, 'Invalid reset token');
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const now = new Date();
    
    logger.info('🔐 Validating reset token', { 
      tokenHashLength: hashedToken.length,
      expiryCheckTime: now.toISOString(),
      ip: req.ip 
    });
    
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: now }
    });

    if (!user) {
      logger.warn('❌ Reset password failed: invalid or expired token', { 
        tokenProvided: Boolean(token),
        ip: req.ip 
      });
      return safeJsonResponse(res, 400, false, 'Invalid or expired reset token');
    }

    logger.info('🔐 Updating password for user', { userId: user._id, email: user.email });
    
    user.password = password;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    // Revoke any existing refresh tokens after password reset
    try {
      await RefreshToken.revokeAllUserTokens(String(user._id));
    } catch (revokeError) {
      logger.warn('Failed to revoke existing refresh tokens after password reset', {
        userId: user._id,
        error: revokeError.message,
        ip: req.ip
      });
    }

    logger.info('✅ Password reset successful', { userId: user._id, email: user.email, ip: req.ip });

    return res.json({ success: true, message: 'Password reset successful. You can now login with your new password.', data: {} });
  } catch (err) {
    logger.error('❌ Reset password error', { 
      error: err.message, 
      errorCode: err.code,
      stack: err.stack,
      ip: req.ip 
    });
    return safeJsonResponse(res, 500, false, 'Failed to reset password');
  }
};

exports.logout = async (req, res) => {
  try {
    const body = req.body || {};
    const refreshToken = body.refreshToken || getCookie(req, REFRESH_TOKEN_COOKIE);
    let resolvedUserId = req.user?._id || req.user?.id || null;

    if (!resolvedUserId) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET, { ignoreExpiration: true });
          resolvedUserId = decoded?.id || null;
        } catch {
          // Ignore malformed access tokens during logout.
        }
      }
    }

    if (!resolvedUserId && refreshToken) {
      try {
        const decoded = jwtService.verifyRefreshToken(refreshToken);
        resolvedUserId = decoded?.id || null;
      } catch {
        // Ignore invalid refresh tokens during logout.
      }
    }

    const validation = validateRefreshTokenUserId(resolvedUserId || '');
    if (validation.valid && await waitForDatabase(5000)) {
      await User.findByIdAndUpdate(validation.userId, { lastActive: new Date() });
    }

    // Use global guard for RefreshToken operations

    if (refreshToken && validation.valid) {
      try {
        const hashedToken = jwtService.hashToken(refreshToken);
        await RefreshToken.updateOne(
          { userId: validation.userId, token: hashedToken, revoked: false },
          { revoked: true, revokedAt: new Date() }
        );
      } catch (dbError) {
        logger.error('Failed to revoke refresh token in logout', {
          error: dbError.message,
          userId: validation.userId,
          ip: req.ip
        });
        // Continue with logout
      }
    } else if (refreshToken && validation.reason === 'invalid_objectid') {
      logger.warn('Skipping refresh token revoke for invalid userId during logout', {
        userId: String(resolvedUserId || 'unknown'),
        ip: req.ip
      });
    }

    clearRefreshCookie(res, req);
    clearAccessCookie(res, req);

    return res.json({ success: true, message: 'Logged out successfully', data: {} });
  } catch (err) {
    logger.error('Logout error', { error: err.message, ip: req.ip });
    clearRefreshCookie(res);
    return safeJsonResponse(res, 500, false, 'Logout failed');
  }
};

exports.refreshToken = async (req, res) => {
  try {
    // ===== STEP 1: VALIDATE COOKIE EXISTENCE =====
    const payload = req.body || {};
    const refreshToken = payload.refreshToken || getCookie(req, REFRESH_TOKEN_COOKIE);
    if (!refreshToken) {
      logger.warn('Refresh endpoint missing refresh token cookie/header', {
        requestId: req.requestId,
        ip: req.ip,
        cookieHeaderExists: Boolean(req.headers?.cookie),
        rawCookieHeader: req.headers?.cookie ? String(req.headers.cookie).slice(0, 200) : null
      });
      return safeJsonResponse(res, 401, false, 'Invalid authentication session');
    }

    // ===== STEP 2: VALIDATE JWT BEFORE ANY DB OPERATIONS =====
    let decoded;
    try {
      decoded = jwtService.verifyRefreshToken(refreshToken);
    } catch (jwtError) {
      logger.warn('Refresh token JWT validation failed', {
        error: jwtError.message,
        ip: req.ip
      });
      clearRefreshCookie(res);
      return safeJsonResponse(res, 401, false, 'Invalid authentication session');
    }

    if (!decoded || decoded.type !== 'refresh' || !decoded.id) {
      clearRefreshCookie(res);
      return safeJsonResponse(res, 401, false, 'Invalid authentication session');
    }

    // ===== STEP 3: VALIDATE USERID BEFORE DB OPERATIONS =====
    const isAdminToken = decoded.id === 'admin-user-id';

    if (!isAdminToken && !mongoose.Types.ObjectId.isValid(decoded.id)) {
      clearRefreshCookie(res);
      return safeJsonResponse(res, 401, false, 'Invalid authentication session');
    }

    // ===== STEP 4: RETRIEVE USER WITH GLOBAL GUARD =====
    let user;
    if (isAdminToken) {
      user = { _id: 'admin-user-id', userType: 'admin' };
    } else {
      // Apply global guard for RefreshToken operations
      const validation = validateRefreshTokenUserId(decoded.id);

      if (!validation.valid) {
        logger.warn('Refresh token validation failed', {
          reason: validation.reason,
          userId: String(decoded.id),
          ip: req.ip
        });
        clearRefreshCookie(res);
        return safeJsonResponse(res, 401, false, 'Invalid authentication session');
      }

      if (!(await requireDatabaseReady(res, 'refreshToken'))) return;

      try {
        const hashedToken = jwtService.hashToken(refreshToken);
        const storedToken = await RefreshToken.findOneAndUpdate(
          {
            token: hashedToken,
            userId: validation.userId,
            revoked: false,
            expiresAt: { $gt: new Date() }
          },
          {
            $set: {
              revoked: true,
              revokedAt: new Date()
            }
          },
          { new: true }
        );

        if (!storedToken) {
          logger.warn('Refresh token reuse, expiry, or revocation detected', {
            userId: validation.userId,
            requestId: req.requestId,
            ip: req.ip
          });
          clearRefreshCookie(res);
          return safeJsonResponse(res, 401, false, 'Invalid authentication session');
        }

        // Fetch user from database
        user = await User.findById(validation.userId).select('-password');
        const accountFailure = getAccountAccessFailure(user, { requireVerified: false });
        if (accountFailure) {
          clearRefreshCookie(res);
          return safeJsonResponse(res, accountFailure.status, false, accountFailure.message, accountFailure.data);
        }
      } catch (dbError) {
        logger.error('Database error in refresh token validation', {
          error: dbError.message,
          userId: String(decoded.id),
          ip: req.ip
        });
        clearRefreshCookie(res);
        return safeJsonResponse(res, 401, false, 'Invalid authentication session');
      }
    }

    // ===== STEP 5: VALIDATE USER EXISTS =====
    const accountFailure = getAccountAccessFailure(user, { requireVerified: false });
    if (accountFailure) {
      logger.warn('User not found for refresh token', {
        userId: String(isAdminToken ? 'admin-user-id' : decoded.id),
        ip: req.ip
      });
      clearRefreshCookie(res);
      return safeJsonResponse(res, accountFailure.status, false, accountFailure.message, accountFailure.data);
    }

    let tokens;
    try {
      const newRole = (decoded && decoded.role) ? String(decoded.role) : (user.userType || 'user');
      tokens = await issueTokenPairWithPersistence(req, res, user._id, newRole);
    } catch (dbError) {
      logger.error('Failed to create new refresh token', {
        error: dbError.message,
        userId: String(user._id),
        ip: req.ip
      });
      clearRefreshCookie(res, req);
      clearAccessCookie(res, req);
      return safeJsonResponse(res, 500, false, 'Token refresh failed. Please login again.');
    }

    return res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn
      }
    });
  } catch (err) {
    console.error('REFRESH TOKEN ERROR (UNHANDLED):', err.message, err.stack);
    logger.error('Refresh token unhandled error', { error: err.message, ip: req.ip });
    clearRefreshCookie(res, req);
    clearAccessCookie(res, req);
    // Never expose stack traces
    return safeJsonResponse(res, 500, false, 'Token refresh failed. Please login again.');
  }
};

// Google OAuth handler
exports.authGoogle = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return safeJsonResponse(res, 400, false, 'Google token is required');
    }

    // Verify Google token on backend (CRITICAL: Never trust frontend token)
    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
    } catch (err) {
      logger.warn('Google token rejected at backend', { error: err.message, ip: req.ip });
      return safeJsonResponse(res, 401, false, 'Invalid Google token');
    }

    const payload = ticket.getPayload();
    if (!payload) {
      logger.warn('Google token rejected at backend', { reason: 'Missing payload', ip: req.ip });
      return safeJsonResponse(res, 401, false, 'Invalid Google token');
    }

    const { sub: googleId, email, picture, email_verified: emailVerified } = payload;

    if (!googleId || !email) {
      return safeJsonResponse(res, 400, false, 'Missing required fields from Google token');
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (emailVerified === false) {
      return safeJsonResponse(res, 401, false, 'Google email is not verified');
    }

    logger.info('Google authentication attempt', {
      googleId,
      email: normalizedEmail.substring(0, 3) + '***',
      ip: req.ip
    });

    // Check if user exists by googleId (primary lookup)
    let user = await User.findOne({ googleId });

    // If not found by googleId, check by email (user may have email account)
    if (!user) {
      user = await User.findOne({ email: normalizedEmail });
    }

    if (!user) {
      logger.warn('Google OAuth rejected for unregistered email', {
        email: normalizedEmail.substring(0, 3) + '***',
        ip: req.ip
      });
      return safeJsonResponse(res, 401, false, 'Invalid email or password');
    } else {
      const accountFailure = getAccountAccessFailure(user, { requireVerified: false });
      if (accountFailure) {
        logger.warn('Google OAuth rejected for inactive account', {
          userId: user._id,
          status: user.status,
          ip: req.ip
        });
        return safeJsonResponse(res, accountFailure.status, false, accountFailure.message, accountFailure.data);
      }

      // Update existing user with Google info if not already linked
      if (!user.googleId) {
        user.googleId = googleId;
        user.authProvider = 'google';
      }

      // Update avatar if provided and not already set
      if (picture && !user.avatar) {
        user.avatar = picture;
      }

      user.lastLogin = new Date();
      await user.save();

      logger.info('Google OAuth user logged in', {
        userId: user._id,
        email: normalizedEmail.substring(0, 3) + '***',
        ip: req.ip
      });
    }

    const accountFailure = getAccountAccessFailure(user);
    if (accountFailure) {
      return safeJsonResponse(res, accountFailure.status, false, accountFailure.message, accountFailure.data);
    }

    const tokens = await issueTokenPair(req, res, user._id, user.userType || 'user');

    logger.info('Google OAuth authentication successful', {
      userId: user._id,
      tokenSnippet: tokens.accessToken.slice(0, 25),
      ip: req.ip
    });

    return res.status(200).json({
      success: true,
      message: 'Google authentication successful',
      data: {
        token: tokens.accessToken,
        user: formatAuthUserPayload(user)
      }
    });
  } catch (err) {
    console.error('GOOGLE AUTH ERROR:', err.message, err.stack);
    logger.error('Google authentication error', { error: err.message, stack: err.stack, ip: req.ip });
    return safeJsonResponse(res, 500, false, 'Google authentication failed. Please try again.');
  }
};
