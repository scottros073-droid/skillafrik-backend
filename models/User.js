const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user','worker','company','client','admin'], default: 'user' }, // added 'admin'
  verified: { type: Boolean, default: false },
  verificationDate: { type: Date },
  isTopUser: { type: Boolean, default: false },
  topExpiry: { type: Date },
  hasPaidHiringFee: { type: Boolean, default: false },
  hiringFeeExpiry: { type: Date },
  wallet: {
    available: { type: Number, default: 0 },
    held: { type: Number, default: 0 },
  },
  rating: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
