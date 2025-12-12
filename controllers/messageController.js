// backend/controllers/messageController.js
const Message = require("../models/Message");

/**
 * Get all messages for a specific room
 */
exports.getMessages = async (req, res) => {
  const { roomId } = req.params;
  try {
    const messages = await Message.find({ roomId }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ message: "Error fetching messages" });
  }
};

/**
 * Create a new message in a room
 */
exports.createMessage = async (req, res) => {
  const { roomId, senderId, message, receiverId, attachments } = req.body;
  try {
    const newMessage = await Message.create({
      roomId,
      senderId,
      receiverId,
      message,
      attachments: attachments || [],
    });
    res.json(newMessage);
  } catch (err) {
    console.error("Error sending message:", err);
    res.status(500).json({ message: "Error sending message" });
  }
};

/**
 * Get all chat rooms for a specific user
 */
exports.getRooms = async (req, res) => {
  const { userId } = req.params;
  try {
    const rooms = await Message.aggregate([
      {
        $match: { $or: [{ senderId: userId }, { receiverId: userId }] },
      },
      {
        $group: {
          _id: "$roomId",
          lastMessage: { $last: "$message" },
          updatedAt: { $last: "$createdAt" },
        },
      },
      { $sort: { updatedAt: -1 } },
    ]);
    res.json(rooms);
  } catch (err) {
    console.error("Error fetching rooms:", err);
    res.status(500).json({ message: "Error fetching rooms" });
  }
};
