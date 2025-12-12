require("dotenv").config();
const axios = require("axios");
const Payment = require("../models/Payment");
const User = require("../models/User");

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = "https://api.paystack.co";

const headers = {
  Authorization: `Bearer ${PAYSTACK_SECRET}`,
  "Content-Type": "application/json",
};

// ==============================
// 1. CREATE PAYMENT RECORD
// ==============================
exports.createPayment = async (req, res) => {
  const { userId, amount, reference, status } = req.body;
  try {
    const payment = await Payment.create({ userId, amount, reference, status });
    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: "Error creating payment record", error: err.message });
  }
};

// ==============================
// 2. VERIFY ACCOUNT PAYMENT ($1)
// ==============================
exports.verifyAccount = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(404).json({ message: "User not found" });

    const payment = await Payment.create({
      userId: user._id,
      amount: 100, // ₦1 in kobo
      currency: "NGN",
      purpose: "verification",
      status: "PENDING",
      gateway: "paystack",
    });

    const response = await axios.post(
      `${PAYSTACK_BASE}/transaction/initialize`,
      {
        email: user.email,
        amount: payment.amount,
        metadata: { paymentId: payment._id, purpose: "verification", userId: user._id },
        callback_url: `${process.env.BASE_URL}/api/payments/webhook`,
      },
      { headers }
    );

    payment.gatewayRef = response.data.data.reference;
    await payment.save();

    res.status(200).json({
      message: "Verification payment created",
      paymentId: payment._id,
      checkoutUrl: response.data.data.authorization_url,
      reference: response.data.data.reference,
    });
  } catch (err) {
    console.error("Verify Account Error:", err.response?.data || err);
    res.status(500).json({ error: "Account verification payment failed" });
  }
};

// ==============================
// 3. INITIATE PAYMENT
// ==============================
exports.initiatePayment = async (req, res) => {
  try {
    const { email, amount, metadata, callback_url } = req.body;
    if (!email || !amount) throw new Error("Email and amount are required");

    const response = await axios.post(
      `${PAYSTACK_BASE}/transaction/initialize`,
      { email, amount: amount * 100, metadata, callback_url },
      { headers }
    );

    res.status(200).json(response.data.data);
  } catch (err) {
    console.error("Initiate Payment Error:", err.response?.data || err);
    res.status(500).json({ error: "Payment initialization failed" });
  }
};

// ==============================
// 4. VERIFY PAYMENT
// ==============================
exports.verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const response = await axios.get(`${PAYSTACK_BASE}/transaction/verify/${reference}`, { headers });
    res.status(200).json(response.data);
  } catch (err) {
    console.error("Verify Payment Error:", err.response?.data || err);
    res.status(500).json({ error: "Payment verification failed" });
  }
};

// ==============================
// 5. CREATE CUSTOMER
// ==============================
exports.createCustomer = async (req, res) => {
  try {
    const { email, first_name, last_name, phone } = req.body;
    const response = await axios.post(
      `${PAYSTACK_BASE}/customer`,
      { email, first_name, last_name, phone },
      { headers }
    );
    res.status(200).json(response.data);
  } catch (err) {
    console.error("Create Customer Error:", err.response?.data || err);
    res.status(500).json({ error: "Customer creation failed" });
  }
};

// ==============================
// 6. TRANSFER TO USER
// ==============================
exports.transferToUser = async (req, res) => {
  try {
    const { recipientCode, amount, reason } = req.body;
    const response = await axios.post(
      `${PAYSTACK_BASE}/transfer`,
      { source: "balance", amount: amount * 100, recipient: recipientCode, reason: reason || "SkillAfrik payout" },
      { headers }
    );
    res.status(200).json({ message: "Transfer initiated", data: response.data });
  } catch (err) {
    console.error("Transfer Error:", err.response?.data || err);
    res.status(500).json({ error: "Transfer failed" });
  }
};

// ==============================
// 7. REFUND PAYMENT
// ==============================
exports.refundPayment = async (req, res) => {
  try {
    const { reference, amount } = req.body;
    const response = await axios.post(
      `${PAYSTACK_BASE}/refund`,
      { transaction: reference, ...(amount && { amount: amount * 100 }) },
      { headers }
    );
    res.status(200).json(response.data);
  } catch (err) {
    console.error("Refund Error:", err.response?.data || err);
    res.status(500).json({ error: "Refund failed" });
  }
};

// ==============================
// 8. WEBHOOK HANDLER
// ==============================
exports.handleWebhook = async (req, res) => {
  try {
    const event = req.body;
    console.log("Webhook Event Received:", event);
    // TODO: handle payments, users, jobs updates based on webhook
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook Error:", err);
    res.sendStatus(500);
  }
};
