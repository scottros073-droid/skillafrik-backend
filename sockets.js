// backend/sockets.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Chat = require('./models/Chat');
const Message = require('./models/Message');
const User = require('./models/User');

const onlineUsers = new Map();

function setupSocket(server) {
  const io = new Server(server, {
    cors: { origin: '*' } // restrict this in production
  });

  // Middleware: require valid JWT to attach userId
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication error'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.id;
      return next();
    } catch (err) {
      console.error('Socket auth failed', err.message);
      return next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    if (userId) {
      onlineUsers.set(userId.toString(), socket.id);
      io.emit('presence:update', Array.from(onlineUsers.keys()));
    }

    socket.on('join', async (roomId) => {
      try {
        socket.join(roomId);

        // Mark messages as read for this user in that chat
        await Message.updateMany(
          { chat: roomId, to: userId, read: false },
          { $set: { read: true } }
        );

        // Emit event to room so other participants can update unread counts
        io.to(roomId).emit('messages:read', { chatId: roomId, userId });

      } catch (err) {
        console.error('join error', err);
      }
    });

    socket.on('leave', (roomId) => {
      socket.leave(roomId);
    });

    socket.on('typing', ({ roomId, isTyping }) => {
      socket.to(roomId).emit('typing', { userId, isTyping });
    });

    socket.on('message:send', async (payload) => {
      // payload: { roomId, text, attachments, toUserId }
      try {
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

        // broadcast to chat room
        io.to(chat._id.toString()).emit('message:new', {
          message,
          chatId: chat._id.toString()
        });

        // notify recipient socket if online
        const toSocketId = onlineUsers.get(payload.toUserId?.toString());
        if (toSocketId) {
          io.to(toSocketId).emit('notification:new', { chatId: chat._id, message });
        }
      } catch (err) {
        console.error('socket message error', err);
        socket.emit('error', { message: 'Message failed' });
      }
    });

    socket.on('disconnect', () => {
      if (userId) {
        onlineUsers.delete(userId.toString());
        io.emit('presence:update', Array.from(onlineUsers.keys()));
      }
    });
  });

  console.log('✅ Socket.io ready');
}

module.exports = { setupSocket, onlineUsers };
