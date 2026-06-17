// backend/controllers/messageController.js
const Message = require("../models/Message");
const Chat = require("../models/Chat");
const { containsBlockedCommunication } = require("../utils/spamFilter");

/**
 * Send a message
 */
exports.sendMessage = async (req, res) => {
  try {
    const { chatId, content, text, message: rawMessage, attachments } = req.body;
    const messageContent = (content || text || rawMessage || "").toString().trim();
    const senderId = req.user.id;

    if (!chatId || !messageContent) {
      return res.status(400).json({ success: false, message: "Chat ID and message content are required" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.some((participantId) => participantId.toString() === senderId.toString())) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    if (containsBlockedCommunication(messageContent)) {
      return res.status(400).json({ success: false, message: "Please keep communication inside the platform" });
    }

    const message = await Message.create({
      chatId,
      senderId,
      content: messageContent,
      attachments: Array.isArray(attachments) ? attachments : []
    });

    // Update chat's last message
    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: messageContent,
      lastMessageAt: new Date(),
      lastMessageBy: senderId
    });

    res.status(201).json({
      id: message._id,
      chatId: message.chatId,
      senderId: message.senderId,
      content: message.content,
      createdAt: message.createdAt
    });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ success: false, message: "Failed to send message" });
  }
};

/**
 * Get messages for a conversation
 */
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user.id;

    // Check if user is part of this conversation
    const chat = await Chat.findById(conversationId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const messages = await Message.find({ chatId: conversationId })
      .populate('senderId', 'firstName lastName avatar')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Mark messages as read
    await Message.updateMany(
      { chatId: conversationId, senderId: { $ne: userId }, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.json({
      messages: messages.reverse().map(msg => ({
        id: msg._id,
        chatId: msg.chatId,
        senderId: msg.senderId?._id || msg.senderId,
        sender: {
          id: msg.senderId?._id || msg.senderId,
          name: [msg.senderId?.firstName, msg.senderId?.lastName].filter(Boolean).join(" ") || "User",
          avatar: msg.senderId?.avatar || null
        },
        content: msg.content,
        attachments: msg.attachments,
        isRead: msg.isRead,
        createdAt: msg.createdAt
      }))
    });
  } catch (error) {
    console.error("Error getting messages:", error);
    res.status(500).json({ success: false, message: "Failed to get messages" });
  }
};

/**
 * Get user's conversations
 */
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.id;

    const chats = await Chat.find({ participants: userId })
      .populate('participants', 'firstName lastName avatar')
      .populate('lastMessageBy', 'firstName lastName')
      .sort({ lastMessageAt: -1 });

    res.json({
      conversations: chats.map(chat => ({
        id: chat._id,
        participants: chat.participants.map(p => ({
          id: p._id,
          name: `${p.firstName} ${p.lastName}`,
          avatar: p.avatar
        })),
        lastMessage: chat.lastMessage,
        lastMessageAt: chat.lastMessageAt,
        unreadCount: Array.isArray(chat.unreadCounts)
          ? chat.unreadCounts.find((entry) => entry.userId?.toString() === userId.toString())?.count || 0
          : 0
      }))
    });
  } catch (error) {
    console.error("Error getting conversations:", error);
    res.status(500).json({ success: false, message: "Failed to get conversations" });
  }
};

/**
 * Mark messages as read
 */
exports.markAsRead = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    await Message.updateMany(
      { chatId, senderId: { $ne: userId }, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.json({
      success: true,
      data: { message: "Messages marked as read" }
    });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    res.status(500).json({ success: false, message: "Failed to mark messages as read" });
  }
};
