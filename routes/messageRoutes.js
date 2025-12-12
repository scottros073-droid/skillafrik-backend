// backend/routes/messageRoutes.js
const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const auth = require("../middleware/authMiddleware"); // optional if you have auth
const { getRooms } = require("../controllers/messageController");

// -----------------------------
// Get all messages for a room
// -----------------------------
router.get("/:roomId", auth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const messages = await Message.find({ chat: roomId }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ message: "Failed to get messages" });
  }
});

// -----------------------------
// Send/create a new message
// -----------------------------
router.post("/", auth, async (req, res) => {
  try {
    const { chatId, from, to, text, attachments } = req.body;
    if (!chatId || !from || !text) {
      return res.status(400).json({ message: "chatId, from, and text are required" });
    }

    const message = await Message.create({ chat: chatId, from, to, text, attachments });
    res.json({ message });
  } catch (err) {
    console.error("Error sending message:", err);
    res.status(500).json({ message: "Failed to send message" });
  }
});

// -----------------------------
// Mark messages as read
// -----------------------------
router.put("/:chatId/read", auth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user?.id || req.body.userId || req.query.userId;
    if (!userId) return res.status(400).json({ message: "userId required" });

    const result = await Message.updateMany(
      { chat: chatId, to: userId, read: false },
      { $set: { read: true } }
    );

    res.json({ modifiedCount: result.modifiedCount ?? 0 });
  } catch (err) {
    console.error("Error marking messages as read:", err);
    res.status(500).json({ message: "Failed to mark read" });
  }
});

// -----------------------------
// Get all chat rooms for a user
// -----------------------------
router.get("/rooms/:userId", auth, getRooms);

module.exports = router;
