const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  
  // Last Message Info
  lastMessage: { type: String, default: '' },
  lastMessageAt: { type: Date, default: null },
  
  // Job Context (optional)
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', default: null },
  
  // Unread Message Counts
  unreadCounts: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    count: { type: Number, default: 0 }
  }],
  
  // Read Status Per User
  readStatus: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastReadAt: { type: Date, default: null }
  }],
  
}, { timestamps: true });

chatSchema.index({ participants: 1 });
chatSchema.index({ jobId: 1 });

module.exports = mongoose.model('Chat', chatSchema);
