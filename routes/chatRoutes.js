// backend/routes/chatRoutes.js
const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const Message = require('../models/Message');

// list chats for current user (requires auth middleware ideally)
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id || req.query.userId; // adapt to your auth middleware
    if (!userId) return res.status(400).json({ message: 'userId required' });

    const chats = await Chat.find({ participants: userId })
      .sort({ updatedAt: -1 })
      .populate('participants', 'name email') // choose fields
      .lean();

    // attach last message
    const enriched = await Promise.all(chats.map(async (c) => {
      const last = await Message.findOne({ chat: c._id }).sort({ createdAt: -1 }).lean();
      return { ...c, lastMessage: last || null };
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to list chats' });
  }
});

// get single chat messages
router.get('/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    const messages = await Message.find({ chat: chatId }).sort({ createdAt: 1 }).lean();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: 'Failed' });
  }
});

module.exports = router;
