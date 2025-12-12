const express = require("express");
const router = express.Router();
const crypto = require("crypto");

const auth = require("../middleware/auth");
const User = require("../models/User");
const Job = require("../models/Job");
const Payment = require("../models/Payment");
const { initializePayment } = require("../utils/paystack");

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET;
if (!PAYSTACK_SECRET) console.error("❌ PAYSTACK_SECRET missing!");

// ------------------------
// Middleware: log requests
// ------------------------
router.use((req, res, next) => {
  console.log(`⚡ Hit ${req.method} ${req.originalUrl}`);
  next();
});

// ======================================================
// JOB ROUTES
// ======================================================

// POST /api/jobs - Post a job or skill
router.post("/jobs", auth, async (req, res) => {
  try {
    const { title, description, amount, deadline } = req.body;
    const user = await User.findById(req.user.id);

    if (!["worker", "company"].includes(user.role)) {
      return res.status(403).json({ message: "You are not allowed to post jobs" });
    }

    const jobData = { title, description, amount, deadline, status: "OPEN" };
    if (user.role === "worker") jobData.workerId = user._id;
    if (user.role === "company") jobData.companyId = user._id;

    const job = await Job.create(jobData);
    res.json({ message: "Job posted successfully", job });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error posting job", error: err.message });
  }
});

// GET /api/jobs - List all jobs
router.get("/jobs", async (req, res) => {
  try {
    const jobs = await Job.find().populate("companyId workerId", "name email role");
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ message: "Error fetching jobs", error: err.message });
  }
});

// POST /api/jobs/:jobId/hire - Create escrow payment for hiring
router.post("/jobs/:jobId/hire", auth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (!job.workerId) return res.status(400).json({ message: "No worker assigned for this job" });

    const payment = await Payment.create({
      jobId,
      userId,
      amount: job.amount,
      currency: job.currency || "NGN",
      purpose: "job_escrow",
      status: "PENDING",
      gateway: "paystack",
    });

    payment.gatewayRef = `PSK_${Date.now()}`;
    await payment.save();

    res.json({
      message: "Payment created for hiring worker",
      paymentId: payment._id,
      gateway: payment.gateway,
      gatewayRef: payment.gatewayRef,
      amount: payment.amount,
      currency: payment.currency,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error creating payment", error: err.message });
  }
});

// POST /api/jobs/:jobId/deliver - Worker delivers a job
router.post("/jobs/:jobId/deliver", auth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { files, message } = req.body;
    const userId = req.user.id;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (job.workerId?.toString() !== userId) {
      return res.status(403).json({ message: "Not authorized to deliver this job" });
    }

    job.status = "DELIVERED";
    job.delivery = { files: files || [], message: message || "", deliveredAt: new Date() };
    await job.save();

    const payment = await Payment.findOne({ jobId, purpose: "job_escrow", status: "PAID" });
    if (payment) {
      job.escrow = { status: "HELD" };
      await job.save();
    }

    res.json({ message: "Job delivered successfully", job });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// POST /api/jobs/:jobId/review - Client reviews delivered job
router.post("/jobs/:jobId/review", auth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user.id;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (job.status !== "DELIVERED") return res.status(400).json({ message: "Job not delivered yet" });
    if (job.companyId?.toString() !== userId && job.clientId?.toString() !== userId) {
      return res.status(403).json({ message: "Not authorized to review this job" });
    }

    job.reviews.push({ reviewerId: userId, rating, comment });
    await job.save();

    // Update worker rating
    const worker = await User.findById(job.workerId);
    const allJobs = await Job.find({ workerId: worker._id, "reviews.rating": { $exists: true } });
    const avgRating =
      allJobs.reduce((sum, j) => {
        const ratings = j.reviews.map((r) => r.rating);
        return sum + (ratings.length ? ratings.reduce((a, b) => a + b) / ratings.length : 0);
      }, 0) / allJobs.length;

    worker.rating = avgRating || 0;
    await worker.save();

    res.json({ message: "Review submitted successfully", job });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error submitting review", error: err.message });
  }
});

// POST /api/jobs/:jobId/release - Client releases escrow
router.post("/jobs/:jobId/release", auth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (job.companyId?.toString() !== userId) return res.status(403).json({ message: "Not authorized to release escrow" });
    if (!job.escrow || job.escrow.status !== "HELD") return res.status(400).json({ message: "Escrow not held or already released" });

    job.escrow.status = "RELEASED";
    job.status = "COMPLETED";
    await job.save();

    const payment = await Payment.findOne({ jobId, purpose: "job_escrow" });
    if (payment) {
      payment.status = "RELEASED";
      await payment.save();
    }

    res.json({ message: "Escrow released, job completed", job });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ======================================================
// PAYMENTS / PAYSTACK ROUTES
// ======================================================

// POST /api/payments/verify-account - $1 verification
router.post("/payments/verify-account", auth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(404).json({ message: "User not found" });

    const payment = await Payment.create({
      userId: user._id,
      amount: 100, // ₦1 in kobo
      currency: "NGN",
      purpose: "verification",
      status: "PENDING",
    });

    const checkout = await initializePayment({
      email: user.email,
      amount: 100,
      callback_url: `${process.env.BASE_URL}/api/payments/paystack-webhook`,
      metadata: { paymentId: payment._id, purpose: "verification", userId: user._id },
    });

    payment.gatewayRef = checkout.reference;
    await payment.save();

    res.json({ checkoutUrl: checkout.authorization_url, paymentId: payment._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/payments/company-hiring - $3 company hiring fee
router.post("/payments/company-hiring", auth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(404).json({ message: "User not found" });

    const payment = await Payment.create({
      userId: user._id,
      amount: 300, // ₦3 in kobo
      currency: "NGN",
      purpose: "company_hiring",
      status: "PENDING",
    });

    const checkout = await initializePayment({
      email: user.email,
      amount: 300,
      callback_url: `${process.env.BASE_URL}/api/payments/paystack-webhook`,
      metadata: { paymentId: payment._id, purpose: "company_hiring", userId: user._id },
    });

    payment.gatewayRef = checkout.reference;
    await payment.save();

    res.json({ checkoutUrl: checkout.authorization_url, paymentId: payment._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/payments/upgrade-top-user - $5 top user upgrade
router.post("/payments/upgrade-top-user", auth, async (req, res) => {
  try {
    const user = await User.findById(req.body.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const payment = await Payment.create({
      userId: user._id,
      amount: 500, // ₦5 in kobo
      currency: "NGN",
      purpose: "top_user",
      status: "PENDING",
    });

    const checkout = await initializePayment({
      email: user.email,
      amount: 500,
      callback_url: `${process.env.BASE_URL}/api/payments/paystack-webhook`,
      metadata: { paymentId: payment._id, purpose: "top_user", userId: user._id },
    });

    payment.gatewayRef = checkout.reference;
    await payment.save();

    res.json({ checkoutUrl: checkout.authorization_url, paymentId: payment._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// POST /api/payments/paystack-webhook
router.post("/payments/paystack-webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const hash = crypto.createHmac("sha512", PAYSTACK_SECRET).update(req.body).digest("hex");
    if (hash !== req.headers["x-paystack-signature"]) return res.status(400).send("Invalid signature");

    const event = JSON.parse(req.body.toString());
    const metadata = event.data?.metadata || {};
    const { purpose, jobId, paymentId } = metadata;

    if (event.event === "charge.success") {
      // Mark payment as PAID
      if (paymentId) {
        const payment = await Payment.findById(paymentId);
        if (payment && payment.status !== "PAID") {
          payment.status = "PAID";
          payment.paidAt = new Date();
          await payment.save();
        }
      }

      // Handle job escrow
      if (purpose === "job_escrow" && jobId) {
        const job = await Job.findById(jobId);
        if (job) {
          job.escrowPaid = true;
          job.escrow = { status: "HELD" };
          await job.save();
        }
      }
    }

    res.send("ok");
  } catch (err) {
    console.error(err);
    res.status(500).send("server error");
  }
});

module.exports = router;
