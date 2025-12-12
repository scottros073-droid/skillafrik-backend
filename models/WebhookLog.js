const mongoose = require('mongoose');

const webhookLogSchema = new mongoose.Schema({
  event: String,
  raw: String,
  receivedAt: { type: Date, default: Date.now },
  handled: { type: Boolean, default: false }
});

module.exports = mongoose.model('WebhookLog', webhookLogSchema);
