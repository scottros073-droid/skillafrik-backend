// filepath: backend/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { validate, paymentSchema } = require('../middleware/validation');
const paymentController = require('../controllers/paymentController');
const Transaction = require('../models/Transaction');
const Payment = require('../models/Payment');

// USD conversion rate
const USD_RATE = 1;

// Convert amount to USD format
const toUSD = (amount) => `$${(amount * USD_RATE).toFixed(2)}`;

// Initialize payment
router.post('/initialize', authMiddleware, paymentController.initiatePayment);

// Verify payment by reference
router.get('/verify/:reference', authMiddleware, paymentController.verifyPayment);

// Get payment history
router.get('/history', authMiddleware, paymentController.getPaymentHistory);

// Get earnings (main endpoint for frontend)
router.get('/earnings', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get all transactions for earnings calculation
    const transactions = await Transaction.find({ 
      userId,
      type: { $in: ['RELEASE', 'credit', 'earning'] }
    }).sort({ createdAt: -1 });

    // Calculate total earnings
    const totalEarnings = transactions
      .filter(t => t.type === 'RELEASE' || t.type === 'credit' || t.type === 'earning')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    // Get pending payments
    const pendingPayments = await Payment.find({
      userId,
      status: 'PENDING'
    });

    const pendingAmount = pendingPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    // Get completed payments
    const completedPayments = await Payment.find({
      userId,
      status: 'PAID'
    });

    const completedAmount = completedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

    res.json({
      success: true,
      data: {
        totalEarnings: toUSD(totalEarnings),
        pendingAmount: toUSD(pendingAmount),
        completedAmount: toUSD(completedAmount),
        recentTransactions: transactions.slice(0, 10).map(t => ({
          id: t._id,
          type: t.type,
          amount: toUSD(t.amount),
          description: t.description || t.type,
          status: t.status || 'completed',
          date: t.createdAt
        }))
      }
    });
  } catch (error) {
    console.error('Get earnings error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Top user payment
router.post('/top-user', authMiddleware, paymentController.initiateTopUser);

// Account verification payment
router.post('/verify-account', authMiddleware, paymentController.initiateVerification);

// Webhook (no auth required - must use express.raw for signature verification)
router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.handleWebhook);

// Legacy route for backward compatibility
router.post('/init', authMiddleware, paymentController.initiatePayment);

module.exports = router;
