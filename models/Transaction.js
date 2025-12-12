const mongoose = require('mongoose');

const txnSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['IN', 'OUT', 'FEE', 'REFUND'], // Deposit, Withdrawal, Fees, Refund
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      default: null,
    },
    amount: {
      type: Number,
      required: true,
      min: [0, 'Amount must be positive'],
    },
    balanceBefore: {
      type: Number,
      default: 0,
    },
    balanceAfter: {
      type: Number,
      default: 0,
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true, // Automatically adds createdAt & updatedAt
  }
);

// Optional index for faster lookup by user
txnSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', txnSchema);
