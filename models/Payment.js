const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    // Related job (optional, for escrow payments)
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", default: null },

    // User who made the payment
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Payment gateway
    gateway: { type: String, default: "paystack" },

    // Gateway reference from Paystack
    gatewayRef: { type: String, default: null, unique: true, sparse: true },

    // Payment details
    amount: { type: Number, required: true },
    currency: { type: String, default: "NGN" },
    email: { type: String }, // Optional but useful for Paystack
    purpose: {
      type: String,
      enum: ["job_escrow", "verification", "top_user", "company_hiring", "upgrade"],
      required: true,
    },

    // Additional metadata
    metadata: { type: Object, default: {} },

    // Payment status
    status: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED", "REFUNDED"],
      default: "PENDING",
    },

    // When payment was completed
    paidAt: { type: Date },
  },
  { timestamps: true } // automatically creates createdAt and updatedAt
);

module.exports = mongoose.model("Payment", paymentSchema);
