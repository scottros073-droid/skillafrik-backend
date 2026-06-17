// backend/routes/chatRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require("../middleware/authMiddleware");
const {
  createChat,
  getChat,
  getChats
} = require("../controllers/chatController");

// Create a new chat
router.post("/", authMiddleware, createChat);
router.post("/conversations", authMiddleware, (req, res, next) => {
  if (req.body?.participantId && !req.body.participants) {
    req.body.participants = [req.body.participantId];
  }
  return createChat(req, res, next);
});

// Get user's chats
router.get("/", authMiddleware, getChats);
router.get("/conversations", authMiddleware, getChats);

// Get chat by ID
router.get("/:chatId", authMiddleware, getChat);
router.get("/conversations/:chatId", authMiddleware, getChat);

module.exports = router;
