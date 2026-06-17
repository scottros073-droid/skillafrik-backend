/**
 * PRODUCTION DEPLOYMENT CONFIGURATION
 * ===================================
 * Optimizes for Render backend + Vercel frontend deployment
 * Handles cold starts, API timeouts, socket reconnects
 * 
 * DEPLOYMENT CACHE CLEAR: 2026-05-13T06:10:00Z
 * Force full redeploy from GitHub main (1e5d3c0+)
 */

// ✅ DEPLOYMENT METADATA
const DEPLOYMENT_INFO = {
  timestamp: '2026-05-13T06:10:00Z',
  buildId: 'force-full-redeploy-cache-clear',
  version: '1.0.0-prod'
};

// ✅ RENDER BACKEND COLD START HANDLING
const getColdStartHandler = () => {
  const startTime = Date.now();
  
  return (req, res, next) => {
    // If first request (cold start), allow extra time
    const elapsed = Date.now() - startTime;
    if (elapsed < 5000) {
      // Cold start window: increase timeout for first requests
      req.setTimeout(30000); // 30s instead of 15s
      res.setTimeout(30000);
    }
    next();
  };
};

// ✅ GRACEFUL DATABASE CONNECTION WITH RETRY
const connectDatabase = async (mongoUri, maxRetries = 3) => {
  const mongoose = require('mongoose');
  const prodLogger = require('../utils/productionLogger');
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        minPoolSize: 5,
        retryWrites: true,
        w: 'majority'
      });
      return true;
    } catch (error) {
      retries++;
      if (retries < maxRetries) {
        prodLogger.warn(`MongoDB connection retry ${retries}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * retries));
      } else {
        prodLogger.error('Failed to connect to MongoDB after retries', error.message);
        throw error;
      }
    }
  }
};

// ✅ API TIMEOUT CONFIGURATION
const getApiTimeoutConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return {
    // Request timeout
    requestTimeout: isProduction ? 30000 : 15000, // 30s prod, 15s dev
    
    // Response timeout
    responseTimeout: isProduction ? 25000 : 10000,
    
    // WebSocket timeout
    socketTimeout: 45000,
    
    // Keep-alive timeout (prevents socket hang-up)
    keepAliveTimeout: 65000,
    
    // Headers timeout
    headersTimeout: 66000,
    
    // Socket.io reconnect settings (for production)
    socketIO: {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10
    }
  };
};

// ✅ VERCEL FRONTEND CACHING HEADERS
const getVercelCacheHeaders = () => {
  return {
    // API routes: no cache (dynamic)
    api: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    },
    
    // Static assets: long-term cache with versioning
    static: {
      'Cache-Control': 'public, max-age=31536000, immutable'
    },
    
    // HTML pages: short-term cache
    html: {
      'Cache-Control': 'public, max-age=3600, s-maxage=3600'
    }
  };
};

// ✅ RENDER-SPECIFIC ENVIRONMENT CHECK
const validateRenderEnvironment = () => {
  const isOnRender = process.env.RENDER === 'true';
  const prodLogger = require('../utils/productionLogger');
  
  if (isOnRender) {
    // Render provides these automatically
    const renderEnv = {
      PORT: process.env.PORT,
      SERVICE_ID: process.env.RENDER_SERVICE_ID,
      GIT_COMMIT: process.env.RENDER_GIT_COMMIT,
      GIT_BRANCH: process.env.RENDER_GIT_BRANCH
    };
    prodLogger.info('Running on Render', renderEnv);
  }
};

// ✅ WEBSOCKET RECONNECTION STRATEGY FOR CLIENT
const getSocketReconnectionConfig = () => {
  return {
    // Initial delay before reconnection
    initialDelay: 1000, // 1 second
    
    // Maximum delay between attempts
    maxDelay: 5000, // 5 seconds
    
    // Maximum reconnection attempts
    maxAttempts: 10,
    
    // Exponential backoff multiplier
    backoffMultiplier: 1.5,
    
    // Jitter to prevent thundering herd
    jitter: 0.1
  };
};

// ✅ PRODUCTION-SAFE API URL HANDLING
const getNormalizedApiUrl = () => {
  let apiUrl = process.env.VITE_API_URL || process.env.REACT_APP_API_URL;
  
  if (!apiUrl) {
    throw new Error('API URL not configured. Set VITE_API_URL or REACT_APP_API_URL');
  }
  
  // Remove trailing slashes
  apiUrl = apiUrl.replace(/\/+$/u, '');
  
  // Ensure /api path is included
  if (!apiUrl.includes('/api')) {
    apiUrl += '/api';
  }
  
  // Validate it's not a loopback URL in production
  const isProduction = process.env.NODE_ENV === 'production';
  const loopbackHosts = [
    ['local', 'host'].join(''),
    ['127', '0', '0', '1'].join('.')
  ];
  if (isProduction && loopbackHosts.some((host) => apiUrl.includes(host))) {
    throw new Error(`Production API URL cannot be loopback: ${apiUrl}`);
  }
  
  return apiUrl;
};

module.exports = {
  getColdStartHandler,
  connectDatabase,
  getApiTimeoutConfig,
  getVercelCacheHeaders,
  validateRenderEnvironment,
  getSocketReconnectionConfig,
  getNormalizedApiUrl
};
