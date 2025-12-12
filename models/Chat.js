// backend/models/Chat.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const chatSchema = new Schema({
  participants: [{ type: Schema.Types.ObjectId, ref: 'User' }], // two users
  lastMessage: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Chat', chatSchema);
