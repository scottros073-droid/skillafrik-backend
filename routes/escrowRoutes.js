// backend/routes/escrowRoutes.js

const express = require("express");
const router = express.Router();
const crypto = require("crypto");

const Payments = require("../models/Payment");
const Jobs = require("../models/Job");
const Users = require("../models/User");
const Transactions = require("../models/Transaction");
const Withdrawals = require("../models/Withdrawal");
const Platform = require("../models/Platform");
const Settings = require("../models/Settings");

// -------------------- MIDDLEWARE PLACEHOLDERS --------------------
// Replace with your real auth middleware
const authClient = (req, res, next) => {
  if (req.user && req.user.role === "client") return next();
  return res.status(401).json({ message: "Unauthorized" });
};

const authWorker = (req, res, next) => {
  if (req.user && req.user.role === "worker") return next();
  return res.status(401).json({ message: "Unauthorized" });
};

// -------------------- PAYSTACK / FLUTTERWAVE SIGNATURE VERIFY --------------------
function verifyGatewaySignature(req) {
  const signature = req.headers["x-paystack-signature"];
  const computed = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest("hex");
  return signature === computed;
}

// -------------------- RAW BODY PARSER FOR WEBHOOK --------------------
const bodyParser = require("body-parser");
const rawBodyParser = bodyParser.raw({ type: "application/json" });

// -------------------- 1️⃣ WEBHOOK HANDLING (HOLD IN ESCROW) --------------------
router.post("/webhooks/payments", rawBodyParser, async (req, res) => {
  try {
    if (!verifyGatewaySignature(req)) return res.status(400).send("invalid");

    const event = JSON.parse(req.body.toString());

    if (event.type === "charge.success") {
      const payment = await Payments.findOne({ gatewayRef: event.data.reference });
      if (!payment || payment.status === "PAID") return res.status(200).send("ok");

      payment.status = "PAID";
      payment.paidAt = new Date();
      await payment.save();

      if (payment.metadata.purpose === "job_escrow") {
        await Jobs.updateOne(
          { _id: payment.jobId },
          { $set: { "escrow.amount": payment.amount, "escrow.status": "HELD" } }
        );

        await Transactions.create({
          type: "IN",
          userId: payment.metadata.userId,
          jobId: payment.jobId,
          amount: payment.amount,
          note: "Funds held in escrow",
        });
      }

      return res.status(200).send("ok");
    }

    res.status(200).send("ignored");
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    res.status(500).send("error");
  }
});

// -------------------- 2️⃣ ESCROW RELEASE (AFTER APPROVAL) --------------------
router.post("/jobs/:id/approve", authClient, async (req, res) => {
  try {
    const job = await Jobs.findById(req.params.id);
    if (!job) return res.status(404).send("Job not found");
    if (job.escrow.status !== "HELD") return res.status(400).send("No funds held");

    const settings = await Settings.findOne() || { platformFeePct: 10 }; // default 10%
    const feePct = settings.platformFeePct / 100;
    const fee = Math.round(job.escrow.amount * feePct);
    const workerNet = job.escrow.amount - fee;

    // Pay worker
    await Users.updateOne({ _id: job.workerId }, { $inc: { "wallet.available": workerNet } });
    await Platform.updateOne({}, { $inc: { balance: fee } });

    // Ledger
    await Transactions.create({ type: "FEE", amount: fee, jobId: job._id, note: "Platform fee" });
    await Transactions.create({
      type: "OUT",
      userId: job.workerId,
      amount: workerNet,
      jobId: job._id,
      note: "Released from escrow",
    });

    job.escrow.status = "RELEASED";
    job.status = "COMPLETED";
    await job.save();

    res.json({ ok: true });
  } catch (err) {
    console.error("🔥 Escrow release error:", err);
    res.status(500).json({ message: "Error releasing escrow" });
  }
});

// -------------------- 3️⃣ WORKER WITHDRAWAL --------------------
router.post("/wallets/withdraw", authWorker, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await Users.findById(req.user.id);
    if (!user) return res.status(404).send("User not found");

    if (user.wallet.available < amount) return res.status(400).send("Insufficient funds");

    const settings = await Settings.findOne() || { withdrawalFee: 50 }; // default fee
    user.wallet.available -= amount;
    user.wallet.held += amount;
    await user.save();

    const withdrawal = await Withdrawals.create({ userId: user._id, amount, status: "PENDING" });

    // Initiate transfer via gateway (pseudo-code, replace with your actual gateway code)
    const transfer = await gateway.transfer({
      amount: amount - settings.withdrawalFee,
      recipient: user.paymentAccount,
    });

    if (transfer.status === "success") {
      withdrawal.status = "COMPLETED";
      withdrawal.gatewayRef = transfer.reference;
      user.wallet.held -= amount;
      await user.save();
    } else {
      withdrawal.status = "FAILED";
      user.wallet.available += amount;
      user.wallet.held -= amount;
      await user.save();
    }

    await withdrawal.save();
    res.json({ ok: true, withdrawal });
  } catch (err) {
    console.error("🔥 Withdrawal error:", err);
    res.status(500).json({ message: "Withdrawal failed" });
  }
});

module.exports = router;
