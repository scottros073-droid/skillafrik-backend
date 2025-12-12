const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');

// Send a message
router.post('/', async (req, res) => {
  try {
    const chat = new Chat(req.body);
    await chat.save();
    res.json({ message: 'Message sent', chat });
  } catch (err) {
    res.status(500).json({ message: 'Failed to send message', error: err.message });
  }
});

// Get messages between two users
router.get('/:senderId/:receiverId', async (req, res) => {
  const { senderId, receiverId } = req.params;
  const messages = await Chat.find({
    $or: [
      { senderId, receiverId },
      { senderId: receiverId, receiverId: senderId }
    ]
  });
  res.json(messages);
});

module.exports = router;
