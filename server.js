// backend/server.js

// -----------------------------
// Imports
// -----------------------------
const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
require("dotenv").config();

// -----------------------------
// App & Middleware
// -----------------------------
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// -----------------------------
// Routes
// -----------------------------
const requireAuth = require("./middleware/authMiddleware");

// Use try-catch to safely require routes in case files are missing
let chatRoutes, messageRoutes, paymentRoutes;

try {
  chatRoutes = require("./routes/chatRoutes");
} catch (err) {
  console.warn("⚠️ chatRoutes not found. Make sure './routes/chatRoutes.js' exists.");
}

try {
  messageRoutes = require("./routes/messageRoutes");
} catch (err) {
  console.warn("⚠️ messageRoutes not found. Make sure './routes/messageRoutes.js' exists.");
}

try {
  paymentRoutes = require("./routes/paymentRoutes");
} catch (err) {
  console.warn("⚠️ paymentRoutes not found. Make sure './routes/paymentRoutes.js' exists.");
}

// Protected routes
if (chatRoutes) app.use("/api/chats", requireAuth, chatRoutes);
if (messageRoutes) app.use("/api/messages", requireAuth, messageRoutes);
if (paymentRoutes) app.use("/api/payments", paymentRoutes);

// -----------------------------
// MongoDB Connection
// -----------------------------
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// -----------------------------
// HTTP & Socket.io Server
// -----------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// Track online users
const onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);

  // User comes online
  socket.on("user:online", ({ userId }) => {
    onlineUsers.set(userId, socket.id);
    io.emit("online:update", Array.from(onlineUsers.keys()));
  });

  // Typing event
  socket.on("typing", ({ chatId, from }) => {
    socket.to(chatId).emit("typing", { chatId, from });
  });

  // Chat message
  socket.on("chat:message", async ({ chatId, from, text, attachments }) => {
    try {
      const Message = require("./models/Message");
      const newMessage = await Message.create({ chat: chatId, from, text, attachments });
      io.to(chatId).emit("chat:message", newMessage);
    } catch (err) {
      console.error("Error saving message:", err);
    }
  });

  // User disconnects
  socket.on("disconnect", () => {
    for (const [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        break;
      }
    }
    io.emit("online:update", Array.from(onlineUsers.keys()));
    console.log("⚡ User disconnected:", socket.id);
  });
});

// -----------------------------
// Start Server
// -----------------------------
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
