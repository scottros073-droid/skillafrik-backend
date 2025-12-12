// backend/models/Platform.js
const mongoose = require("mongoose");

const PlatformSchema = new mongoose.Schema({
  balance: { type: Number, default: 0 }, // platform earnings
});

module.exports = mongoose.model("Platform", PlatformSchema);
