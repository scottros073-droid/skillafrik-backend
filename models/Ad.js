const mongoose = require('mongoose');

const adSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  imageUrl: { type: String, required: true },
  link: { type: String, required: true },
  
  // Category
  category: { type: String, default: 'general' },
  
  // Creator (Admin or Advertiser)
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Status
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  
  // Analytics
  views: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  
}, { timestamps: true });

adSchema.index({ status: 1 });
adSchema.index({ createdBy: 1 });

module.exports = mongoose.model('Ad', adSchema);
