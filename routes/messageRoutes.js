// backend/routes/messageRoutes.js
const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/authMiddleware");
const { rateLimit } = require("../middleware/rateLimit");
const {
  sendMessage,
  getMessages,
  getConversations,
  markAsRead
} = require("../controllers/messageController");

// Send a message
router.post("/", authMiddleware, rateLimit({ windowMs: 60000, max: 60 }), sendMessage);

// Get user's conversations
router.get("/conversations", authMiddleware, getConversations);

// Get messages for a conversation
router.get("/:conversationId", authMiddleware, getMessages);

// Mark messages as read
router.put("/:chatId/read", authMiddleware, markAsRead);

module.exports = router;
