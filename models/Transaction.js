const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Transaction Type
  type: {
    type: String,
    enum: [
      'ESCROW',
      'RELEASE',
      'WITHDRAWAL',
      'DEPOSIT',
      'FEE',
      'REFUND',
      'REFERRAL',
      'AI_DEDUCT',
      'TRANSFER',
      'JOB_BOOST',
      'JOB_FEATURE',
      'PREMIUM_SUBSCRIPTION',
      'AI_CREDITS_PURCHASE',
      'AI_CREDITS_USAGE'
    ],
    required: true,
  },
  
  // Amount & Currency
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'NGN' },
  
  // Status
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
  
  // Related Records
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', default: null },
  escrowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Escrow', default: null },
  paymentReference: { type: String, default: null },
  
  // Balance Tracking
  balanceBefore: { type: Number, default: 0 },
  balanceAfter: { type: Number, default: 0 },
  
  // Description
  description: { type: String, default: '' },
  note: { type: String, default: '' },
  walletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', default: null },
  metadata: { type: Object, default: {} },
  
  // For Cross-User Transfers
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  
}, { timestamps: true });

// Indexes
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ userId: 1, type: 1, createdAt: -1 });
transactionSchema.index({ userId: 1, type: 1, status: 1, createdAt: -1 });
transactionSchema.index({ jobId: 1 });
transactionSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
