require('dotenv').config(); // ADD THIS AT THE TOP
const crypto = require('crypto');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET;
if (!PAYSTACK_SECRET) {
  console.error("❌ PAYSTACK_SECRET is undefined. Check your .env file!");
  process.exit(1);
}

const payload = JSON.stringify({
  event: "charge.success",
  data: {
    reference: "test_ref_12345",
    amount: 100,
    metadata: {
      userId: "YOUR_USER_ID",
      purpose: "verification"
    }
  }
});

const signature = crypto
  .createHmac('sha512', PAYSTACK_SECRET)
  .update(payload)
  .digest('hex');

console.log("x-paystack-signature:", signature);
