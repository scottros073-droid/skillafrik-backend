const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  
  // Message Content
  content: { type: String, required: true },
  attachments: [{ type: String }], // File URLs
  
  // Read Status
  isRead: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
  
  // Compliance Status
  isBlocked: { type: Boolean, default: false },
  violationType: { type: String, default: null }, // e.g., 'phone_number', 'email', 'external_platform'
  violationReason: { type: String, default: null },
  
}, { timestamps: true });

messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });

module.exports = mongoose.model('Message', messageSchema);
