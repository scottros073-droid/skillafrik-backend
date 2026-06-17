const mongoose = require('mongoose');

const escrowSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true, unique: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Amount
  amount: { type: Number, required: true },
  currency: { type: String, default: 'NGN' },
  
  // Status: PENDING -> FUNDED -> RELEASED/REFUNDED
  status: { 
    type: String, 
    enum: ['PENDING', 'FUNDED', 'RELEASED', 'REFUNDED', 'DISPUTED'],
    default: 'PENDING'
  },
  
  // Payment Reference (from Paystack)
  paymentReference: { type: String, default: null },
  paymentVerified: { type: Boolean, default: false },
  
  // Dates
  fundedAt: { type: Date, default: null },
  releasedAt: { type: Date, default: null },
  autoReleaseDateAt: { type: Date, default: null }, // Auto-release after 7 days if client inactive
  refundedAt: { type: Date, default: null },
  
  // Release Details
  releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Admin ID or system
  releaseNotes: { type: String, default: null },
  
  // Dispute
  disputed: { type: Boolean, default: false },
  disputeReason: { type: String, default: null },
  disputedAt: { type: Date, default: null },
  
  // Milestones for smart escrow
  milestones: [{
    title: { type: String, required: true },
    description: { type: String },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'in_progress', 'completed', 'released'], default: 'pending' },
    dueDate: { type: Date },
    completedAt: { type: Date },
    releasedAt: { type: Date }
  }],
  
}, { timestamps: true });

escrowSchema.index({ clientId: 1 });
escrowSchema.index({ freelancerId: 1 });
escrowSchema.index({ status: 1 });

module.exports = mongoose.model('Escrow', escrowSchema);
