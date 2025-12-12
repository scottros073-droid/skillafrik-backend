const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Job = require('../models/Job');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET;
if (!PAYSTACK_SECRET) console.error('❌ PAYSTACK_SECRET is missing in .env!');

// ------------------------
// Local test webhook (Postman testing)
// ------------------------
/**
 * POST /payments/test
 * Simulate a Paystack webhook locally in Postman
 * Example JSON body:
 * {
 *   "type": "charge.success",
 *   "data": {
 *     "metadata": {
 *       "purpose": "verification" | "top_user" | "company_hiring" | "job_escrow",
 *       "userId": "<userId>",
 *       "jobId": "<jobId>",
 *       "paymentId": "<paymentId>"
 *     }
 *   }
 * }
 */
router.post('/payments/test', express.json(), async (req, res) => {
  try {
    const event = req.body;
    console.log('⚡ Local test webhook received:', event.type || event.event);

    const metadata = event.data?.metadata || {};
    const { userId, purpose, jobId, paymentId } = metadata;

    // Mark payment as PAID if paymentId exists
    if (paymentId) {
      const payment = await Payment.findById(paymentId);
      if (payment && payment.status !== 'PAID') {
        payment.status = 'PAID';
        payment.paidAt = new Date();
        await payment.save();
        console.log(`Payment ${payment._id} marked as PAID (local test)`);
      }
    }

    // Handle different purposes
    switch (purpose) {
      case 'verification':
        if (userId) {
          await User.findByIdAndUpdate(userId, { verified: true, verificationDate: new Date() });
          console.log(`User ${userId} verified (local test)`);
        }
        break;

      case 'top_user':
        if (userId) {
          await User.findByIdAndUpdate(userId, { isTopUser: true, topUserDate: new Date() });
          console.log(`User ${userId} upgraded to Top User (local test)`);
        }
        break;

      case 'company_hiring':
        if (userId) {
          await User.findByIdAndUpdate(userId, {
            hasPaidHiringFee: true,
            hiringFeeExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          });
          console.log(`Company ${userId} hiring fee marked as PAID (local test)`);
        }
        break;

      case 'job_escrow':
        if (jobId) {
          await Job.findByIdAndUpdate(jobId, { escrowPaid: true });
          console.log(`Job ${jobId} escrow marked PAID (local test)`);
        }
        break;

      default:
        console.log('No action defined for purpose:', purpose);
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('Local test webhook error:', err);
    res.status(500).send('server error');
  }
});

// ------------------------
// Real Paystack webhook
// ------------------------
/**
 * POST /payments
 * Handles real Paystack webhook events
 * Use header 'x-local-test: true' for Postman testing
 */
router.post('/payments', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    let event;

    if (req.headers['x-local-test']) {
      event = JSON.parse(req.body.toString());
      console.log('⚡ Local test webhook received (raw):', event.type || event.event);
    } else {
      // Verify Paystack signature
      const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(req.body).digest('hex');
      if (hash !== req.headers['x-paystack-signature']) {
        console.log('❌ Invalid signature');
        return res.status(400).send('Invalid signature');
      }

      event = JSON.parse(req.body.toString());
      console.log('✅ Paystack webhook event received:', event.event);
    }

    if ((event.event || event.type) === 'charge.success') {
      const metadata = event.data.metadata || {};
      const { userId, purpose, jobId, paymentId } = metadata;

      // Mark payment as PAID
      if (paymentId) {
        const payment = await Payment.findById(paymentId);
        if (payment && payment.status !== 'PAID') {
          payment.status = 'PAID';
          payment.paidAt = new Date();
          await payment.save();
          console.log(`Payment ${payment._id} marked as PAID`);
        }
      }

      // Handle purposes
      switch (purpose) {
        case 'verification':
          if (userId) await User.findByIdAndUpdate(userId, { verified: true, verificationDate: new Date() });
          break;

        case 'top_user':
          if (userId) await User.findByIdAndUpdate(userId, { isTopUser: true, topUserDate: new Date() });
          break;

        case 'company_hiring':
          if (userId) await User.findByIdAndUpdate(userId, {
            hasPaidHiringFee: true,
            hiringFeeExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          });
          break;

        case 'job_escrow':
          if (jobId) await Job.findByIdAndUpdate(jobId, { escrowPaid: true });
          break;

        default:
          console.log('No action defined for purpose:', purpose);
      }
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook Error:', err);
    res.status(500).send('server error');
  }
});

// ------------------------
// Test helper webhook (manual Postman testing)
// ------------------------
/**
 * POST /payments/test-helper
 * Automatically creates a test payment and marks it as PAID
 * Example JSON body:
 * {
 *   "purpose": "verification" | "top_user" | "company_hiring" | "job_escrow",
 *   "userId": "<userId>",
 *   "jobId": "<jobId>",
 *   "paymentId": "<paymentId>" // optional
 * }
 */
router.post('/payments/test-helper', express.json(), async (req, res) => {
  try {
    const { purpose, userId, jobId, paymentId } = req.body;

    let payment = paymentId
      ? await Payment.findById(paymentId)
      : await Payment.create({
          userId: userId || null,
          jobId: jobId || null,
          amount: 100, // dummy amount
          currency: 'USD',
          purpose,
          status: 'PENDING',
        });

    if (!payment) return res.status(404).json({ message: 'Payment not found' });

    // Mark payment as PAID
    payment.status = 'PAID';
    payment.paidAt = new Date();
    await payment.save();
    console.log(`✅ Payment ${payment._id} marked as PAID`);

    // Handle purposes
    switch (purpose) {
      case 'verification':
        if (userId) await User.findByIdAndUpdate(userId, { verified: true, verificationDate: new Date() });
        break;

      case 'top_user':
        if (userId) await User.findByIdAndUpdate(userId, { isTopUser: true, topUserDate: new Date() });
        break;

      case 'company_hiring':
        if (userId) await User.findByIdAndUpdate(userId, {
          hasPaidHiringFee: true,
          hiringFeeExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
        break;

      case 'job_escrow':
        if (jobId) await Job.findByIdAndUpdate(jobId, { escrowPaid: true });
        break;

      default:
        console.log(`⚠️ Unknown purpose: ${purpose}`);
    }

    res.json({
      message: 'Test payment processed successfully',
      paymentId: payment._id,
      purpose,
    });
  } catch (err) {
    console.error('Test helper webhook error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
