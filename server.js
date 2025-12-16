// backend/server.js

// -----------------------------
// Imports
// -----------------------------
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

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

// ✅ AUTH ROUTES (VERY IMPORTANT)
const authRoutes = require("./routes/authRoutes");
app.use("/api/auth", authRoutes);

// Optional routes (safe loading)
let chatRoutes, messageRoutes, paymentRoutes;

try {
  chatRoutes = require("./routes/chatRoutes");
} catch {
  console.warn("⚠️ chatRoutes missing");
}

try {
  messageRoutes = require("./routes/messageRoutes");
} catch {
  console.warn("⚠️ messageRoutes missing");
}

try {
  paymentRoutes = require("./routes/paymentRoutes");
} catch {
  console.warn("⚠️ paymentRoutes missing");
}

// Protected routes
if (chatRoutes) app.use("/api/chats", requireAuth, chatRoutes);
if (messageRoutes) app.use("/api/messages", requireAuth, messageRoutes);
if (paymentRoutes) app.use("/api/payments", paymentRoutes);

// -----------------------------
// MongoDB Connection
// -----------------------------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// -----------------------------
// HTTP & Socket.io Server
// -----------------------------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Track online users
const onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);

  socket.on("user:online", ({ userId }) => {
    onlineUsers.set(userId, socket.id);
    io.emit("online:update", [...onlineUsers.keys()]);
  });

  socket.on("typing", ({ chatId, from }) => {
    socket.to(chatId).emit("typing", { chatId, from });
  });

  socket.on("chat:message", async ({ chatId, from, text, attachments }) => {
    try {
      const Message = require("./models/Message");
      const newMessage = await Message.create({
        chat: chatId,
        from,
        text,
        attachments,
      });
      io.to(chatId).emit("chat:message", newMessage);
    } catch (err) {
      console.error("❌ Message error:", err);
    }
  });

  socket.on("disconnect", () => {
    for (const [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) onlineUsers.delete(userId);
    }
    io.emit("online:update", [...onlineUsers.keys()]);
    console.log("⚡ User disconnected:", socket.id);
  });
});

// -----------------------------
// Start Server
// -----------------------------
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
