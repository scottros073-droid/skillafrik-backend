const mongoose = require('mongoose');

const aiCreditSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // Credit Types
  proposalCredits: { type: Number, default: 5 },
  designCredits: { type: Number, default: 3 },
  cvCredits: { type: Number, default: 2 },

  // Usage Tracking
  proposalCreditsUsed: { type: Number, default: 0 },
  designCreditsUsed: { type: Number, default: 0 },
  cvCreditsUsed: { type: Number, default: 0 },

  // Total usage
  totalUsed: { type: Number, default: 0 },

  // Premium Status
  isPremium: { type: Boolean, default: false },
  premiumExpiryDate: { type: Date, default: null },
  hasUnlimitedCredits: { type: Boolean, default: false },

  // Reset Date
  creditResetDate: { type: Date, default: null },

}, { timestamps: true });

module.exports = mongoose.model('AICredit', aiCreditSchema);
