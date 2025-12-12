// backend/routes/paymentRoutes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");

// Models
const User = require("../models/User");
const Payment = require("../models/Payment");
const Job = require("../models/Job");

// Paystack controllers
const {
  initializePayment,
  verifyPayment,
  createCustomer,
  transferToUser,
  refundPayment,
  handleWebhook,
  verifyAccount,
} = require("../controllers/paystackController");

// -----------------------------------
// LOG EVERY REQUEST
// -----------------------------------
router.use((req, res, next) => {
  console.log(`⚡ ${req.method} ${req.originalUrl}`);
  next();
});

/*----------------------------------------------------------
| 1. ACCOUNT VERIFICATION
----------------------------------------------------------*/
router.post("/verify-account", auth, verifyAccount);

/*----------------------------------------------------------
| 2. UPGRADE TOP USER ($5)
----------------------------------------------------------*/
router.post("/upgrade-top-user", auth, async (req, res) => {
  try {
    const user = req.user;

    const payment = await Payment.create({
      userId: user._id,
      amount: 500,
      currency: "NGN",
      purpose: "top_user",
      status: "PENDING",
    });

    const checkout = await initializePayment({
      email: user.email,
      amount: 500,
      callback_url: `${process.env.BASE_URL}/api/payments/webhook`,
      metadata: { paymentId: payment._id, purpose: "top_user", userId: user._id },
    });

    payment.gatewayRef = checkout.reference;
    await payment.save();

    res.json({
      message: "Top user upgrade initiated",
      checkoutUrl: checkout.authorization_url,
      paymentId: payment._id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/*----------------------------------------------------------
| 3. COMPANY HIRING FEE ($3)
----------------------------------------------------------*/
router.post("/company-hiring", auth, async (req, res) => {
  try {
    const user = req.user;

    const payment = await Payment.create({
      userId: user._id,
      amount: 300,
      currency: "NGN",
      purpose: "company_hiring",
      status: "PENDING",
    });

    const checkout = await initializePayment({
      email: user.email,
      amount: 300,
      callback_url: `${process.env.BASE_URL}/api/payments/webhook`,
      metadata: { paymentId: payment._id, purpose: "company_hiring", userId: user._id },
    });

    payment.gatewayRef = checkout.reference;
    await payment.save();

    res.json({
      checkoutUrl: checkout.authorization_url,
      paymentId: payment._id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/*----------------------------------------------------------
| 4. ESCROW PAYMENT FOR JOB
----------------------------------------------------------*/
router.post("/create", auth, async (req, res) => {
  try {
    const { jobId, userId } = req.body;

    if (!jobId || !userId) {
      return res.status(400).json({ message: "jobId and userId required" });
    }

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });

    const payment = await Payment.create({
      jobId,
      userId,
      amount: job.amount,
      currency: job.currency || "NGN",
      purpose: "job_escrow",
      status: "PENDING",
      gateway: "paystack",
      gatewayRef: `PSK_${Date.now()}`,
    });

    res.json({
      message: "Payment created for hiring worker",
      paymentId: payment._id,
      gatewayRef: payment.gatewayRef,
      amount: payment.amount,
      currency: payment.currency,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

/*----------------------------------------------------------
| 5. GENERIC PAYSTACK ROUTES
----------------------------------------------------------*/
// Initialize payment
router.post("/init", auth, async (req, res) => {
  try {
    const { email, amount, metadata, callback_url } = req.body;
    const checkout = await initializePayment({ email, amount, metadata, callback_url });
    res.json(checkout);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Verify payment
router.get("/verify/:reference", auth, verifyPayment);

// Customer creation
router.post("/customer", auth, createCustomer);

// Transfer to user
router.post("/transfer", auth, transferToUser);

// Refund payment
router.post("/refund", auth, refundPayment);

// Webhook handler
router.post("/webhook", handleWebhook);

/*----------------------------------------------------------
| 6. LOCAL DEV TEST WEBHOOK
----------------------------------------------------------*/
router.post("/test", async (req, res) => {
  try {
    const { paymentId, purpose } = req.body;

    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    payment.status = "PAID";
    await payment.save();

    if (purpose === "job_escrow") {
      const job = await Job.findById(payment.jobId);
      if (job) {
        job.escrow = { status: "HELD" };
        job.escrowPaid = true;
        await job.save();
      }
    }

    res.json({
      message: "Test payment processed",
      paymentId,
      purpose,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

module.exports = router;
