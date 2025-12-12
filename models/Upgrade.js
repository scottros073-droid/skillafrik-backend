const mongoose = require('mongoose');

const upgradeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  plan: { type: String, required: true },
  paymentStatus: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
}, { timestamps: true });

module.exports = mongoose.model('Upgrade', upgradeSchema);
