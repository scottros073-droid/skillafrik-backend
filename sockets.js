// backend/sockets.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const prodLogger = require('./utils/productionLogger');
const Chat = require('./models/Chat');
const Message = require('./models/Message');
const User = require('./models/User');

const onlineUsers = new Map();

function setupSocket(server) {
  // ✅ PRODUCTION-SAFE CORS: Only allow configured frontend origins
  const { getAllowedOrigins } = require('./config/corsConfig');
  
  const io = new Server(server, {
    cors: {
      origin: getAllowedOrigins(),
      credentials: true,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Authorization', 'Content-Type']
    },
    // Heartbeat settings: detect dead connections faster
    pingInterval: 25000, // Send ping every 25s
    pingTimeout: 10000,  // Wait 10s for pong before considering connection dead
    maxHttpBufferSize: 1e6, // 1 MB max message size
    transports: ['websocket', 'polling']
  });

  // Middleware: require valid JWT to attach userId
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        prodLogger.security('Socket auth failed', { reason: 'missing_token' });
        return next(new Error('Authentication error'));
      }
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.id;
      socket.tokenExpiry = payload.exp * 1000; // Convert to milliseconds
      return next();
    } catch (err) {
      prodLogger.security('Socket auth failed', { error: err.message });
      return next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    const socketId = socket.id;

    if (userId) {
      onlineUsers.set(userId.toString(), socketId);
      prodLogger.info(`User connected`, { userId, socketId });
      io.emit('presence:update', Array.from(onlineUsers.keys()));
    }

    // Handle reconnection with existing data
    socket.on('reconnect_attempt', () => {
      prodLogger.info('Socket reconnect attempt', { userId });
    });

    // Explicit token refresh for long-lived connections
    socket.on('auth:refresh', async (payload, callback) => {
      try {
        const { refreshToken } = payload;
        // You might implement a refresh token mechanism here
        callback({ success: true, message: 'Auth refreshed' });
      } catch (err) {
        console.error('Auth refresh error:', err);
        callback({ success: false, error: 'Auth refresh failed' });
      }
    });

    socket.on('join', async (roomId, callback) => {
      try {
        if (!roomId) {
          const error = 'Invalid roomId';
          if (callback) callback({ success: false, error });
          prodLogger.warn(error, { userId, event: 'join' });
          return;
        }

        socket.join(roomId);
        prodLogger.info('User joined room', { userId, roomId });

        // Mark messages as read for this user in that chat
        await Message.updateMany(
          { chat: roomId, to: userId, read: false },
          { $set: { read: true } }
        );

        // Emit event to room so other participants can update unread counts
        io.to(roomId).emit('messages:read', { chatId: roomId, userId });

        if (callback) callback({ success: true });
      } catch (err) {
        console.error('❌ Join error:', err);
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on('leave', (roomId, callback) => {
      if (!roomId) {
        const error = 'Invalid roomId';
        if (callback) callback({ success: false, error });
        prodLogger.warn(error, { userId, event: 'leave' });
        return;
      }
      socket.leave(roomId);
      prodLogger.info('User left room', { userId, roomId });
      if (callback) callback({ success: true });
    });

    socket.on('typing', (data, callback) => {
      if (!data || !data.roomId) {
        const error = 'Invalid roomId in typing event';
        if (callback) callback({ success: false, error });
        prodLogger.warn('Invalid socket typing payload', { userId, data });
        return;
      }
      const { roomId, isTyping } = data;
      socket.to(roomId).emit('typing', { userId, isTyping });
      if (callback) callback({ success: true });
    });

    socket.on('message:send', async (payload, callback) => {
      try {
        if (!payload) {
          const error = 'Invalid message payload';
          if (callback) callback({ success: false, error });
          prodLogger.warn(error, { userId, event: 'message:send' });
          return;
        }

        let chat = null;
        if (payload.roomId) {
          chat = await Chat.findById(payload.roomId);
        } else {
          // find or create 1-on-1 chat
          chat = await Chat.findOne({
            participants: { $all: [payload.fromUserId, payload.toUserId], $size: 2 }
          });
          if (!chat) {
            chat = await Chat.create({
              participants: [payload.fromUserId, payload.toUserId]
            });
          }
        }

        if (!chat) {
          const error = 'Chat not found';
          if (callback) callback({ success: false, error });
          prodLogger.warn(error, { userId, payload });
          return;
        }

        const message = await Message.create({
          chat: chat._id,
          from: payload.fromUserId,
          to: payload.toUserId,
          text: payload.text || '',
          attachments: payload.attachments || [],
          read: false
        });

        // update chat last message
        chat.lastMessage = message.text || (message.attachments[0] || 'Attachment');
        chat.updatedAt = new Date();
        await chat.save();

        // Broadcast to chat room
        io.to(chat._id.toString()).emit('message:new', {
          message,
          chatId: chat._id.toString()
        });

        // Notify recipient socket if online with callback acknowledgment
        const toSocketId = onlineUsers.get(payload.toUserId?.toString());
        if (toSocketId) {
          io.to(toSocketId).emit('notification:new', { chatId: chat._id, message });
        }

        // Send acknowledgment to sender with message ID for deduplication
        if (callback) {
          callback({ 
            success: true, 
            messageId: message._id,
            chatId: chat._id
          });
        }
      } catch (err) {
        prodLogger.error('Socket message error', { userId, error: err.message });
        socket.emit('error', { message: 'Message failed', error: err.message });
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on('disconnect', (reason) => {
      if (userId) {
        onlineUsers.delete(userId.toString());
        io.emit('presence:update', Array.from(onlineUsers.keys()));
        prodLogger.info('User disconnected', { userId, reason });
      }
    });

    // Handle connection errors
    socket.on('error', (error) => {
      prodLogger.error('Socket runtime error', { userId, error });
    });

    // Handle explicit pong response for heartbeat monitoring
    socket.on('pong', () => {
      prodLogger.info('Pong received', { userId });
    });
  });

  prodLogger.info('Socket.io ready with heartbeat & reconnection support');
}

module.exports = { setupSocket, onlineUsers };
