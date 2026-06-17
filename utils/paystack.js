const axios = require('axios');
const crypto = require('crypto');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;
const USE_PAYSTACK_MOCK = process.env.PAYSTACK_TEST_MODE === 'true' || !PAYSTACK_SECRET_KEY;

if (!PAYSTACK_SECRET_KEY) {
  console.warn('⚠️ Paystack secret key not found in environment variables!');
}

const paystackAPI = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  }
});

async function initializePayment({ amount, email, reference, metadata = {}, callbackUrl }) {
  try {
    if (USE_PAYSTACK_MOCK) {
      const defaultFrontendUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.PRODUCTION_FRONTEND_URL || process.env.APP_URL || process.env.PUBLIC_APP_URL || 'http://localhost:5173';
      return {
        authorization_url: callbackUrl || `${defaultFrontendUrl}/paystack/callback?reference=${reference}`,
        access_code: `test_${reference}`,
        reference
      };
    }

    const amountInKobo = Math.round(amount);
    const payload = {
      email,
      amount: amountInKobo,
      reference,
      metadata
    };

    if (callbackUrl) {
      payload.callback_url = callbackUrl;
    }

    const response = await paystackAPI.post('/transaction/initialize', payload);
    return response.data.data;
  } catch (error) {
    console.error('Paystack initialization error:', error.response?.data || error.message);
    throw new Error('Failed to initialize payment');
  }
}

async function verifyPayment(reference) {
  try {
    if (USE_PAYSTACK_MOCK) {
      return {
        status: 'success',
        reference,
        paid_at: new Date().toISOString(),
        amount: 0,
        gateway_response: 'Test mode approved'
      };
    }

    const response = await paystackAPI.get(`/transaction/verify/${reference}`);
    return response.data.data;
  } catch (error) {
    console.error('Paystack verification error:', error.response?.data || error.message);
    throw new Error('Failed to verify payment');
  }
}

async function createRecipient(accountNumber, bankCode, accountName) {
  try {
    const response = await paystackAPI.post('/transferrecipient', {
      type: 'nuban',
      name: accountName,
      account_number: accountNumber,
      bank_code: bankCode
    });
    return response.data.data;
  } catch (error) {
    console.error('Paystack recipient creation error:', error.response?.data || error.message);
    throw new Error('Failed to create recipient');
  }
}

async function transferToAccount(recipientCode, amount, reason = '') {
  try {
    const amountInKobo = Math.round(amount * 100);
    const response = await paystackAPI.post('/transfer', {
      source: 'balance',
      recipient: recipientCode,
      amount: amountInKobo,
      reason
    });
    return response.data.data;
  } catch (error) {
    console.error('Paystack transfer error:', error.response?.data || error.message);
    throw new Error('Failed to transfer funds');
  }
}

async function verifyBankAccount(accountNumber, bankCode) {
  try {
    const response = await paystackAPI.get('/bank/resolve', {
      params: {
        account_number: accountNumber,
        bank_code: bankCode
      }
    });
    return response.data.data;
  } catch (error) {
    console.error('Paystack bank verification error:', error.response?.data || error.message);
    throw new Error('Failed to verify bank account');
  }
}

async function getBanks() {
  try {
    const response = await paystackAPI.get('/bank');
    return response.data.data;
  } catch (error) {
    console.error('Paystack get banks error:', error.response?.data || error.message);
    throw new Error('Failed to get banks');
  }
}

async function getBalance() {
  try {
    const response = await paystackAPI.get('/balance');
    return response.data.data;
  } catch (error) {
    console.error('Paystack get balance error:', error.response?.data || error.message);
    throw new Error('Failed to get account balance');
  }
}

function verifyWebhook(req) {
  // Verify signature header
  const signature = req.headers['x-paystack-signature'];
  if (!signature) {
    console.warn('⚠️ Webhook missing x-paystack-signature header');
    return false;
  }

  const rawBody = req.rawBody ||
    (Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body));

  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');

  if (hash !== signature) {
    console.warn('⚠️ Webhook signature verification failed');
    return false;
  }

  return true;
}

/**
 * Verify webhook is legitimate by cross-checking with Paystack API
 * This prevents replay attacks and ensures data integrity
 * @param {string} reference - Paystack transaction reference
 * @returns {object|null} Verification data or null if invalid
 */
async function verifyWebhookWithPaystack(reference) {
  try {
    // Query Paystack to verify the transaction exists and is valid
    const verification = await verifyPayment(reference);
    
    // Additional validation
    if (!verification || verification.status !== 'success') {
      return null;
    }

    return verification;
  } catch (error) {
    console.error('Failed to verify webhook with Paystack:', error.message);
    return null;
  }
}

module.exports = {
  initializePayment,
  verifyPayment,
  createRecipient,
  transferToAccount,
  verifyBankAccount,
  getBanks,
  getBalance,
  verifyWebhook,
  verifyWebhookWithPaystack
};
