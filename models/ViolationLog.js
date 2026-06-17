const mongoose = require('mongoose');

const violationLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Violation Details
  violationType: { 
    type: String, 
    enum: ['phone_number', 'email', 'external_platform', 'prohibited_phrase', 'escrow_bypass', 'payment_circumvention', 'contact_exchange'],
    required: true 
  },
  
  // Message Context
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  messageContent: { type: String, default: null },
  detectedKeyword: { type: String, default: null },
  
  // Action Taken
  actionTaken: { type: String, enum: ['blocked', 'logged', 'warned'], default: 'blocked' },
  isAppealable: { type: Boolean, default: true },
  
  // Appeal Status
  appealed: { type: Boolean, default: false },
  appealAt: { type: Date, default: null },
  appealReason: { type: String, default: null },
  appealStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: null },
  
  // Repeat Tracking
  isRepeatViolation: { type: Boolean, default: false },
  violationCountIn30Days: { type: Number, default: 1 },
  
}, { timestamps: true });

violationLogSchema.index({ userId: 1, createdAt: -1 });
violationLogSchema.index({ violationType: 1 });

module.exports = mongoose.model('ViolationLog', violationLogSchema);
