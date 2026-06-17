const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  revieweeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Review Details
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  
  // Review Type: client reviewing freelancer or freelancer reviewing client
  reviewType: { type: String, enum: ['client_to_freelancer', 'freelancer_to_client'], required: true },
  
  // Moderation
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedAt: { type: Date, default: null },
  rejectedReason: { type: String, default: null },
  
}, { timestamps: true });

reviewSchema.index({ jobId: 1 });
reviewSchema.index({ reviewerId: 1 });
reviewSchema.index({ revieweeId: 1 });
reviewSchema.index({ jobId: 1, reviewerId: 1 }, { unique: true });
reviewSchema.index({ jobId: 1, reviewerId: 1, revieweeId: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
