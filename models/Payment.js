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
      enum: [
        "job_escrow",
        "verification",
        "verify",
        "top_user",
        "company_hiring",
        "upgrade",
        "boost",
        "feature",
        "subscription",
        "deposit",
        "general"
      ],
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

    // Subscription-related
    subscriptionType: { type: String, enum: ["monthly", "yearly"], default: null },
    subscriptionActivated: { type: Boolean, default: false },

    // When payment was completed
    paidAt: { type: Date },
    verifiedAt: { type: Date },
    gatewayResponse: { type: Object, default: null },
    authorizationUrl: { type: String, default: null },
    accessCode: { type: String, default: null },
  },
  { timestamps: true } // automatically creates createdAt and updatedAt
);

// Indexes for performance
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ purpose: 1, 'metadata.escrowId': 1, status: 1 });

module.exports = mongoose.model("Payment", paymentSchema);
