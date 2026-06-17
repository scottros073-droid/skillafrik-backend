const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  
  // Balance Types
  available: { type: Number, default: 0, min: 0 },
  escrow: { type: Number, default: 0, min: 0 },
  frozen: { type: Number, default: 0, min: 0 },
  
  // Total Balance
  totalBalance: { type: Number, default: 0, min: 0 },
  
  // Currency
  currency: { type: String, default: 'NGN' },
  
  // Withdrawal Info
  minimumWithdrawal: { type: Number, default: 5000 },
  lastWithdrawalDate: { type: Date, default: null },
  totalWithdrawnAmount: { type: Number, default: 0 },
  
  // AI Credits
  aiCredits: {
    proposal: { type: Number, default: 5 },
    design: { type: Number, default: 3 },
    cv: { type: Number, default: 2 },
  },
  
  // Referral Balance
  referralBalance: { type: Number, default: 0 },
  
}, { timestamps: true });

// Calculate total before saving
walletSchema.pre('save', function(next) {
  this.totalBalance = this.available + this.escrow;
  next();
});

// Indexes for performance
walletSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Wallet', walletSchema);
