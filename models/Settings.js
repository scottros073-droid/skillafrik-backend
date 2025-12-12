// backend/models/Settings.js
const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  platformFeePct: { type: Number, default: 10 },
  autoApproveDays: { type: Number, default: 7 },
  minWithdrawal: { type: Number, default: 1000 },
  withdrawalFee: { type: Number, default: 100 },
  verificationFee: { type: Number, default: 1.0 },
  topUserFee: { type: Number, default: 5.0 },
  companyHiringFee: { type: Number, default: 3.0 },
  topUserDurationDays: { type: Number, default: 30 },
  hiringFeeDurationDays: { type: Number, default: 30 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Settings', settingsSchema);
