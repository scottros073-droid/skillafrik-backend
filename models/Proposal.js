const mongoose = require('mongoose');

const proposalSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Proposal Details
  coverLetter: { type: String, required: true },
  proposedRate: { type: Number, required: true },
  timelineInDays: { type: Number, required: true },
  
  // Status: pending | accepted | rejected
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  
  // Acceptance & Rejection
  acceptedAt: { type: Date, default: null },
  rejectedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null },
  
}, { timestamps: true });

proposalSchema.index({ jobId: 1 });
proposalSchema.index({ freelancerId: 1 });
proposalSchema.index({ clientId: 1 });
proposalSchema.index({ freelancerId: 1, status: 1 });
proposalSchema.index({ jobId: 1, freelancerId: 1 }, { unique: true });

module.exports = mongoose.model('Proposal', proposalSchema);
