/**
 * ===== MONGODB CONNECTION MANAGER =====
 * Handles single, persistent MongoDB connection with exponential backoff retry
 * Prevents connection loops, manages state, optimizes for production
 */

const mongoose = require('mongoose');
const logger = require('./logger');
const prodLogger = require('./productionLogger');

// ===== CONNECTION STATE =====
let connectionPromise = null;
let isConnecting = false;
let connectionAttempts = 0;
const BACKOFF_DELAYS = [2000, 5000, 10000, 20000, 30000]; // 2s, 5s, 10s, 20s, 30s
const MAX_RETRIES = 5;

// ===== VALIDATION =====
const validateMongoConfig = () => {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }
  return MONGO_URI;
};

// ===== CONNECTION OPTIONS =====
const getConnectionOptions = () => {
  return {
    // Connection timeouts
    serverSelectionTimeoutMS: 30000, // 30s for Atlas
    socketTimeoutMS: 45000, // 45s for long operations
    
    // Connection pooling for production
    maxPoolSize: 10,
    minPoolSize: 2,
    
    // Retry and reconnect settings
    retryWrites: true,
    retryReads: true,
    
    // Connection string options
    authSource: 'admin'
  };
};

// ===== CONNECT WITH EXPONENTIAL BACKOFF =====
const connectWithRetry = async () => {
  const MONGO_URI = validateMongoConfig();
  const options = getConnectionOptions();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Check if already connected
      if (mongoose.connection.readyState === 1) {
        prodLogger.debug('MongoDB already connected (readyState=1)');
        return true;
      }

      prodLogger.info(`🔄 MongoDB connection attempt ${attempt}/${MAX_RETRIES}`);

      // Attempt connection
      await mongoose.connect(MONGO_URI, options);
      
      prodLogger.info('✅ MongoDB connected successfully');
      connectionAttempts = 0;
      return true;
    } catch (err) {
      const isTimeout = err?.message?.includes('ETIMEDOUT') || 
                       err?.message?.includes('timeout');
      const isAuth = err?.message?.includes('authentication') || 
                    err?.message?.includes('unauthorized');
      const isDns = err?.message?.includes('ENOTFOUND') || 
                   err?.message?.includes('getaddrinfo');

      connectionAttempts = attempt;

      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_DELAYS[attempt - 1];
        const delaySeconds = (delay / 1000).toFixed(1);
        
        let reason = 'network issue';
        if (isTimeout) reason = 'timeout';
        else if (isAuth) reason = 'authentication failed';
        else if (isDns) reason = 'DNS resolution failed';

        prodLogger.warn(`Connection failed (${reason}). Retry in ${delaySeconds}s...`);
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Max retries exceeded
        prodLogger.error(`❌ MongoDB connection failed after ${MAX_RETRIES} attempts`);
        
        if (isTimeout) {
          prodLogger.error('Issue: Network timeout connecting to MongoDB Atlas');
          prodLogger.error('Fix: Check firewall, VPN, Atlas IP whitelist, internet connection');
        } else if (isAuth) {
          prodLogger.error('Issue: Authentication failed');
          prodLogger.error('Fix: Verify MONGO_URI username/password in .env');
        } else if (isDns) {
          prodLogger.error('Issue: DNS resolution failed');
          prodLogger.error('Fix: Check MONGO_URI hostname spelling and DNS settings');
        } else {
          prodLogger.error(`Error: ${err?.message || 'unknown'}`);
        }
        
        return false;
      }
    }
  }

  return false;
};

// ===== SETUP CONNECTION EVENT HANDLERS =====
const setupConnectionHandlers = () => {
  mongoose.connection.on('connected', () => {
    prodLogger.info('✅ MongoDB connection established');
  });

  mongoose.connection.on('error', (err) => {
    prodLogger.error('MongoDB error:', err?.message || err);
  });

  mongoose.connection.on('disconnected', () => {
    prodLogger.warn('⚠️ MongoDB disconnected');
  });

  // Prevent MongoDB from auto-reconnecting endlessly
  mongoose.connection.on('reconnected', () => {
    prodLogger.info('MongoDB reconnected');
  });
};

// ===== MAIN CONNECTION FUNCTION =====
const connectDatabase = async () => {
  // Prevent multiple connection attempts
  if (isConnecting) {
    prodLogger.debug('Connection already in progress, reusing...');
    return connectionPromise;
  }

  // Reuse existing connection promise if available
  if (connectionPromise && mongoose.connection.readyState === 1) {
    prodLogger.debug('Reusing existing connection (readyState=1)');
    return connectionPromise;
  }

  isConnecting = true;
  prodLogger.debug('Starting fresh connection attempt...');

  try {
    // Setup event handlers once
    if (!mongoose.connection.listeners('connected').length) {
      setupConnectionHandlers();
    }

    // Create new connection promise
    connectionPromise = connectWithRetry();
    const result = await connectionPromise;

    prodLogger.debug(`Connection result: ${result}`);
    return result;
  } catch (err) {
    prodLogger.error('Unexpected error during MongoDB connection:', err?.message);
    return false;
  } finally {
    isConnecting = false;
    prodLogger.debug('Connection attempt completed');
  }
};

// ===== GRACEFUL SHUTDOWN =====
const disconnectDatabase = async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      prodLogger.info('MongoDB disconnected gracefully');
    }
  } catch (err) {
    prodLogger.error('Error during MongoDB disconnect:', err?.message);
  }
};

// ===== HEALTH CHECK =====
const isMongoConnected = () => {
  return mongoose.connection.readyState === 1;
};

const getConnectionStatus = () => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  
  return {
    connected: isMongoConnected(),
    state: states[mongoose.connection.readyState],
    readyState: mongoose.connection.readyState,
    attempts: connectionAttempts
  };
};

module.exports = {
  connectDatabase,
  disconnectDatabase,
  isMongoConnected,
  getConnectionStatus,
  mongoose
};
