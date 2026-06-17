const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Ticket Details
  subject: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, default: 'general' },
  
  // Status
  status: { type: String, enum: ['open', 'in-progress', 'resolved', 'closed'], default: 'open' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  
  // Assignment
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Admin ID
  
  // Messages
  messages: [{
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    content: { type: String, required: true },
    attachments: [{ type: String }],
    createdAt: { type: Date, default: Date.now }
  }],
  
  // Resolution
  resolvedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },
  
}, { timestamps: true });

supportTicketSchema.index({ userId: 1 });
supportTicketSchema.index({ status: 1 });
supportTicketSchema.index({ assignedTo: 1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
