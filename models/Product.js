const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  currency: { type: String, default: "NGN" },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Users" },
  images: [String],
  status: { type: String, enum: ["AVAILABLE", "SOLD"], default: "AVAILABLE" },
}, { timestamps: true });

module.exports = mongoose.model("Products", productSchema);
