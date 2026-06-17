const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  referredEmail: { type: String, default: null },
  
  // Referral Code
  referralCode: { type: String, required: true, unique: true },
  
  // Status
  status: { type: String, enum: ['pending', 'active', 'completed'], default: 'pending' },
  
  // Earnings
  commissionAmount: { type: Number, default: 0 },
  commissionRate: { type: Number, default: 10 }, // percentage
  
  // Dates
  referredAt: { type: Date, default: Date.now },
  activatedAt: { type: Date, default: null },
  
}, { timestamps: true });

referralSchema.index({ referrerId: 1 });
referralSchema.index({ referredUserId: 1 });
referralSchema.index({ referralCode: 1 });

module.exports = mongoose.model('Referral', referralSchema);
