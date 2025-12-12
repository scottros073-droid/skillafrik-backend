const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET; // Use the secret from .env

if (!PAYSTACK_SECRET) {
  console.warn("⚠️ Paystack secret key not found in environment variables!");
}

// Axios instance for Paystack
const paystack = axios.create({
  baseURL: "https://api.paystack.co",
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET}`,
    "Content-Type": "application/json",
  },
});

// Initialize a payment
async function initializePayment({ email, amount, callback_url, metadata }) {
  try {
    const amountInKobo = amount * 100;
    const response = await paystack.post("/transaction/initialize", {
      email,
      amount: amountInKobo,
      callback_url,
      metadata,
    });
    return response.data.data;
  } catch (error) {
    console.error(
      "Paystack initializePayment error:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// Verify transaction
async function verifyTransaction(reference) {
  try {
    const response = await paystack.get(`/transaction/verify/${reference}`);
    return response.data.data;
  } catch (error) {
    console.error(
      "Paystack verifyTransaction error:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// Verify Paystack webhook signature
function verifySignature(rawBody, signature) {
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(rawBody)
    .digest("hex");
  return hash === signature;
}

module.exports = {
  paystack,
  initializePayment,
  verifyTransaction,
  verifySignature,
};
