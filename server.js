const path = require('path');
require('./config/loadEnv');

// ✅ VALIDATE ENVIRONMENT EARLY
const { validateEnvironment, getConfig } = require('./utils/envValidator');
const config = getConfig();
validateEnvironment();

const prodLogger = require('./utils/productionLogger');
prodLogger.info('🚀 Server initialization started');

const express = require('express');
const cors = require('cors');
const http = require('http');
const mongoose = require('mongoose');
const { Server: SocketIOServer } = require('socket.io');
const jwt = require('jsonwebtoken');
const compression = require('compression');
const corsConfig = require('./config/corsConfig');
const { getConnectionStatus } = require('./utils/mongoConnectionManager');

// ===== SERVICES =====
const CronService = require('./services/cronService');

// ===== MIDDLEWARE =====
const { authMiddleware, adminMiddleware } = require('./middleware/authMiddleware');
const { complianceMiddleware } = require('./middleware/complianceMiddleware');
const errorHandler = require('./middleware/errorHandler');
const secureHeadersMiddleware = require('./middleware/secureHeaders');
const logger = require('./utils/logger');
const { requestContext, apiTiming } = require('./middleware/observability');
const { installMongooseObservability } = require('./utils/mongooseObservability');

// ===== ROUTES =====
const authRoutes = require('./routes/authRoutes');
const {
  userRouter,
  profileRouter,
  freelancerRouter,
  publicProfileRouter,
  usersRouter
} = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const jobRoutes = require('./routes/jobRoutes');
const proposalRoutes = require('./routes/proposalRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const walletRoutes = require('./routes/walletRoutes');
const escrowRoutes = require('./routes/escrowRoutes');
const messageRoutes = require('./routes/messageRoutes');
const chatRoutes = require('./routes/chatRoutes');
const portfolioRoutes = require('./routes/portfolioRoutes');
const adRoutes = require('./routes/adRoutes');
const gamificationRoutes = require('./routes/gamificationRoutes');
const adminRoutes = require('./routes/adminRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const hireRoutes = require('./routes/hireRoutes');
const monetizationRoutes = require('./routes/monetizationRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const communityRoutes = require('./routes/communityRoutes');
const supportRoutes = require('./routes/supportRoutes');
const categoriesRoutes = require('./routes/categoriesRoutes');
const skillMatchRoutes = require('./routes/skillMatchRoutes');
const ordersRoutes = require('./routes/ordersRoutes');
const agentRoutes = require('./routes/agentRoutes');
const marketplaceRoutes = require('./routes/marketplaceRoutes');
const observabilityRoutes = require('./routes/observabilityRoutes');
const aiRoutes = require('./routes/aiRoutes');

// ===== INIT APP =====
const app = express();
app.set('trust proxy', 1); // Trust the Vite proxy one hop for secure cookie and forwarded proto handling
const PORT = config.port;

// ===== ENV CHECK LOGS =====
prodLogger.info('ENV CHECK', {
  PORT: config.port,
  FRONTEND_URL: process.env.FRONTEND_URL ? 'OK' : 'MISSING',
  JWT_SECRET: process.env.JWT_SECRET ? 'OK' : 'MISSING',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? 'OK' : 'MISSING',
  MONGO_URI: process.env.MONGO_URI ? 'OK' : 'MISSING'
});

// ===== CREATE SERVER =====
const server = http.createServer(app);

// ===== SOCKET.IO =====
const io = new SocketIOServer(server, {
  cors: corsConfig.corsOptions
});
app.set('io', io);

// ===== GLOBAL STATE =====
const onlineUsers = new Map();

// ✅ CORS FIRST
app.use(cors(corsConfig.corsOptions));

// ===== BODY PARSER =====
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf, encoding) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api/payments/webhook')) {
      req.rawBody = buf.toString(encoding || 'utf8');
    }
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(secureHeadersMiddleware);
app.use(requestContext);
app.use(apiTiming);
app.use((req, res, next) => {
  if (req.method === 'GET' && /^\/api\/(dashboard|jobs|marketplace|auth)(\/|$)/.test(req.path)) {
    res.setHeader('Cache-Control', 'private, no-store');
  }
  next();
});
app.use((req, res, next) => {
  const watched = /^\/api\/(jobs|local-jobs|proposals|upload|user|profile|messages|chat|marketplace)(\/|$)/.test(req.path);
  if (!watched) return next();

  const startedAt = Date.now();
  res.on('finish', () => {
    if (res.statusCode < 400) return;
    console.warn('[FLOW_TRACE]', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      userId: req.user?._id || req.user?.id || 'anonymous',
      hasAuth: Boolean(req.get('authorization')),
      bodyFields: req.body && typeof req.body === 'object' ? Object.keys(req.body).slice(0, 12) : [],
      contentType: req.get('content-type') || '',
      origin: req.get('origin') || '',
      durationMs: Date.now() - startedAt
    });
  });
  return next();
});

// Gzip compression for faster response
app.use(compression({ filter: (req, res) => {
  if (req.headers['x-no-compression']) return false;
  return compression.filter(req, res);
}, level: 6 }));

// ===== STATIC FILES (PUBLIC ASSETS) =====
app.use('/public', express.static(path.join(__dirname, "public")));
app.use('/uploads', express.static(path.join(__dirname, "uploads"), {
  index: false,
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}));
app.get('/public/logo.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'logos', 'logo.png'));
});
app.get('/public/default.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'logos', 'logo.png'));
});

// ===== REQUEST LOGGING =====
app.use(logger.requestLogger);

// ===== SECURITY MIDDLEWARE =====
const { helmetConfig, generalLimiter, paymentLimiter, dashboardLimiter, mongoSanitize } = require('./middleware/security');

app.use(helmetConfig);
app.use(mongoSanitize);
app.use('/api', (req, res, next) => {
  const path = req.path || '';
  if (/^\/(auth|dashboard|jobs|local-jobs|marketplace|notifications|health)(\/|$)/.test(path)) {
    return next();
  }
  return generalLimiter(req, res, next);
});
app.use('/api/dashboard', dashboardLimiter);
app.use('/api/payments', paymentLimiter);

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.send('🚀 SkillAfrik API RUNNING');
});

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Server healthy' });
});

app.get('/api/health', (req, res) => {
  const dbStatus = getConnectionStatus();
  // Return 200 even if DB not connected yet - server is responsive
  // Tests can proceed and DB will connect in background
  res.json({ 
    success: true, 
    message: 'API responsive',
    dbStatus,
    warning: dbStatus.connected ? undefined : 'Database connection initializing'
  });
});

// ===== DATABASE =====
mongoose.set('bufferCommands', false);
installMongooseObservability();

// Import optimized MongoDB connection manager with exponential backoff
const { connectDatabase, disconnectDatabase, isMongoConnected } = require('./utils/mongoConnectionManager');

// ===== SERVER START =====
const startServer = async () => {
  const BASE_PORT = parseInt(process.env.PORT) || 5000;
  const MAX_PORT = BASE_PORT + 10;
  
  for (let port = BASE_PORT; port <= MAX_PORT; port++) {
    try {
      // Try to start the server directly on the port
      await new Promise((resolve, reject) => {
        const listenHost = process.env.HOST || '0.0.0.0';
        server.listen(port, listenHost, () => {
          prodLogger.info('Server started', { port, host: listenHost });
          resolve(port);
        })
          .on('error', (err) => {
            reject(err);
          });
      });
      
      // Only start cron jobs in production
      if (process.env.NODE_ENV === 'production') {
        CronService.startAll();
      }
      return;
    } catch (err) {
      if (err.code === 'EADDRINUSE' && port < MAX_PORT) {
        continue;
      }
      prodLogger.error('Server startup error', err.message || err);
      logger.error('Server startup error', { error: err.message || err, stack: err.stack });
      process.exit(1);
    }
  }
  
  prodLogger.error('No available ports found', { basePort: BASE_PORT, maxPort: MAX_PORT });
  process.exit(1);
};

// ===== ROUTES =====
app.use('/api/auth', authRoutes);
app.use('/api/user', userRouter);
app.use('/api/profile', profileRouter);
app.use('/api/freelancers', freelancerRouter);
app.use('/api/public-profile', publicProfileRouter);
app.use('/api/users', usersRouter);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/observability', observabilityRoutes);

app.use('/api/jobs', jobRoutes);
app.use('/api/local-jobs', require('./routes/localJobRoutes'));
app.use('/api/proposals', proposalRoutes);
app.use('/api/hire', hireRoutes);

app.use('/api/payments', paymentRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/escrow', escrowRoutes);

app.use('/api/messages', messageRoutes);
app.use('/api/chat', chatRoutes);

app.use('/api/portfolio', portfolioRoutes);
app.use('/api/portfolios', portfolioRoutes);

app.use('/api/ads', adRoutes);
app.use('/api/gamification', gamificationRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api/notifications', notificationRoutes);
app.use('/api/reviews', reviewRoutes);

app.use('/api/community', communityRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/skill-match', skillMatchRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/agent', agentRoutes);

app.use('/api/upload', uploadRoutes);
app.use('/api', monetizationRoutes);
app.use('/api/ai', aiRoutes);

// ===== ADDITIONAL ROUTES FOR FRONTEND COMPATIBILITY =====
app.use('/api/marketplace', marketplaceRoutes); // Marketplace routes
app.use('/api/transactions', walletRoutes); // Transactions under wallet

// ===== FALLBACK ROUTES FOR AXIOS INTERCEPTOR (strips /api from URLs) =====
const dashboardRoutesFallback = require('./routes/dashboardRoutes');
const paymentRoutesFallback = require('./routes/paymentRoutes');
const jobRoutesFallback = require('./routes/jobRoutes');

app.use('/dashboard', dashboardRoutesFallback); // Fallback for /dashboard/overview
app.use('/payments', paymentRoutesFallback); // Fallback for /payments/earnings
app.use('/jobs', jobRoutesFallback); // Fallback for /jobs
app.use('/ai', aiRoutes); // Fallback for AI requests without /api prefix

// ===== 404 =====
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// ===== ERROR HANDLER =====
app.use(errorHandler);

// ===== SOCKET LOGIC =====
const chatFilterService = require('./services/chatFilterService');

io.on('connection', (socket) => {
  const parseCookieHeader = (cookieHeader = '') => {
    return cookieHeader.split(';').reduce((acc, cookiePair) => {
      const [name, ...rest] = cookiePair.trim().split('=');
      if (!name) return acc;
      acc[name] = decodeURIComponent(rest.join('='));
      return acc;
    }, {});
  };

  const authenticateSocket = (token) => {
    if (!token) return null;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      onlineUsers.set(decoded.id, socket.id);
      io.emit('online:update', Array.from(onlineUsers.keys()));
      socket.emit('connected');
      logger.info('Socket authenticated', { userId: decoded.id, socketId: socket.id });
      return decoded.id;
    } catch (err) {
      logger.warn('Socket authentication failed', { socketId: socket.id, reason: err.message });
      return null;
    }
  };

  const handshakeCookies = parseCookieHeader(socket.handshake.headers?.cookie || '');
  authenticateSocket(socket.handshake.auth?.token || handshakeCookies.accessToken);
  const authTimeout = setTimeout(() => {
    if (!socket.userId) {
      logger.warn('Unauthenticated socket disconnected', { socketId: socket.id });
      socket.disconnect(true);
    }
  }, 5000);

  socket.on('join', ({ token, userId } = {}) => {
    const authenticatedUserId = socket.userId || authenticateSocket(token);
    if (!authenticatedUserId || (userId && userId.toString() !== authenticatedUserId.toString())) {
      socket.disconnect(true);
      return;
    }

    clearTimeout(authTimeout);
    socket.join(`user:${authenticatedUserId}`);
    socket.emit('connected');
  });

  socket.on('joinRoom', ({ roomId }) => {
    if (!socket.userId || !roomId || typeof roomId !== 'string') return;
    socket.join(roomId);
    logger.info('Socket room joined', { userId: socket.userId, roomId });
  });

  socket.on('sendMessage', ({ roomId, message }) => {
    if (!socket.userId || !roomId || typeof roomId !== 'string') return;
    // Filter message for contact exchange attempts
    const safetyCheck = chatFilterService.checkMessageSafety(message);
    
    if (safetyCheck.isBlocked) {
      socket.emit('messageBlocked', {
        reason: safetyCheck.blockedReason,
        warning: chatFilterService.getRandomWarning()
      });
      return;
    }
    
    if (safetyCheck.shouldWarn) {
      socket.emit('messageWarning', {
        warnings: safetyCheck.warnings,
        message: safetyCheck.sanitized
      });
    }
    
    // Send filtered/sanitized message
    io.to(roomId).emit('receiveMessage', {
      message: safetyCheck.sanitized,
      senderId: socket.userId,
      timestamp: new Date(),
      isFiltered: safetyCheck.warnings.length > 0
    });
  });

  // Typing indicator
  socket.on('typing', ({ roomId, isTyping }) => {
    if (!socket.userId || !roomId || typeof roomId !== 'string') return;
    socket.to(roomId).emit('userTyping', { isTyping });
  });

  // Last seen
  socket.on('lastSeen', ({ userId }) => {
    if (!socket.userId || userId?.toString() !== socket.userId?.toString()) return;
    io.emit('userLastSeen', { userId, timestamp: new Date() });
  });

  socket.on('disconnect', (reason) => {
    clearTimeout(authTimeout);
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      logger.info('Socket disconnected', { userId: socket.userId, socketId: socket.id, reason });
    }
  });
});


// ===== GLOBAL ERROR HANDLERS =====
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

// ===== SERVER INITIALIZATION =====
let isInitialized = false;

const initializeServer = async () => {
  if (isInitialized) return;
  isInitialized = true;

  // Start server immediately (non-blocking)
  startServer();

  // Connect to DB in background using dedicated manager
  connectDatabase()
    .then((connected) => {
      if (connected) {
        // Intentionally quiet in production (warnings/errors only)
        // ===== RUN STALE TOKEN CLEANUP (non-blocking) =====
        const { scheduleCleanup } = require('./utils/cleanupStaleTokens');
        scheduleCleanup().catch((err) => {
          logger.error('Failed to initialize token cleanup', { error: err.message });
        });
      } else {
        prodLogger.warn('⚠️ MongoDB unavailable - running in degraded mode');
      }
    })
    .catch((err) => {
      prodLogger.error('Connection initialization error:', err?.message);
    });
};

initializeServer().catch((err) => {
  console.error('Failed to initialize server:', err);
  process.exit(1);
});

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGTERM', async () => {
  prodLogger.info('SIGTERM received, shutting down gracefully...');
  await disconnectDatabase();
  process.exit(0);
});

process.on('SIGINT', async () => {
  prodLogger.info('SIGINT received, shutting down gracefully...');
  await disconnectDatabase();
  process.exit(0);
});

module.exports = server;
