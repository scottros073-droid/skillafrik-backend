// backend/routes/walletRoutes.js

const express = require('express');
const { authMiddleware } = require('../middleware/authMiddleware');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const monetizationService = require('../services/monetizationService');

const router = express.Router();

// Get wallet
router.get('/', authMiddleware, async (req, res) => {
  try {
    let wallet = await Wallet.findOne({ userId: req.user._id });
    
    if (!wallet) {
      wallet = await Wallet.create({ userId: req.user._id });
    }

    res.json({
      success: true,
      statusCode: 200,
      message: 'Wallet retrieved',
      data: wallet || { userId: req.user._id, balance: 0, available: 0, totalBalance: 0 }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to get wallet',
      error: err.message
    });
  }
});

// Get wallet (alternate endpoint)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    let wallet = await Wallet.findOne({ userId: req.user._id });
    
    if (!wallet) {
      wallet = await Wallet.create({ userId: req.user._id });
    }

    res.json({
      success: true,
      statusCode: 200,
      message: 'Wallet retrieved',
      data: wallet || { userId: req.user._id, balance: 0, available: 0, totalBalance: 0 }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to get wallet',
      error: err.message
    });
  }
});

// Get wallet balance summary
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    let wallet = await Wallet.findOne({ userId: req.user._id });
    
    if (!wallet) {
      wallet = await Wallet.create({ userId: req.user._id });
    }

    res.json({
      success: true,
      statusCode: 200,
      message: 'Wallet balance retrieved',
      data: {
        available: wallet.available,
        escrow: wallet.escrow,
        frozen: wallet.frozen,
        totalBalance: wallet.totalBalance,
        currency: wallet.currency
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to get wallet balance',
      error: err.message
    });
  }
});

const topUpWallet = async (req, res) => {
  try {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: 'Invalid amount'
      });
    }

    const result = await monetizationService.updateWalletBalance(req.user._id, amount, 'credit', 'Wallet top-up');
    const updatedWallet = result.wallet;

    res.json({
      success: true,
      statusCode: 200,
      message: 'Wallet topped up successfully',
      data: {
        wallet: updatedWallet,
        transaction: result.transaction
      }
    });
  } catch (err) {
    console.error('Add wallet funds error:', err);
    res.status(400).json({
      success: false,
      statusCode: 400,
      message: 'Failed to add funds to wallet',
      error: err.message
    });
  }
};

// Add funds to wallet
router.post('/add', authMiddleware, topUpWallet);
router.post('/fund', authMiddleware, topUpWallet);

// Get transactions
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      Transaction.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments({ userId: req.user._id })
    ]);

    res.json({
      success: true,
      statusCode: 200,
      message: 'Transactions retrieved',
      data: transactions || [],
      pagination: {
        total,
        page,
        limit
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to get transactions',
      error: err.message
    });
  }
});

// Request withdrawal
router.post('/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount, bankCode, accountNumber, accountName } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: 'Invalid amount'
      });
    }

    const wallet = await Wallet.findOne({ userId: req.user._id });
    if (!wallet || wallet.available < amount) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: 'Insufficient balance'
      });
    }

    // Deduct from wallet
    await Wallet.findOneAndUpdate(
      { userId: req.user._id },
      {
        $inc: { available: -amount }
      }
    );

    // Create transaction
    const transaction = await Transaction.create({
      userId: req.user._id,
      type: 'WITHDRAWAL',
      amount,
      status: 'pending',
      description: 'Wallet withdrawal',
      metadata: { bankCode, accountNumber, accountName }
    });

    res.json({
      success: true,
      statusCode: 200,
      message: 'Withdrawal request submitted',
      data: transaction
    });
  } catch (err) {
    console.error('Withdrawal request error:', err);
    res.status(400).json({
      success: false,
      statusCode: 400,
      message: 'Failed to process withdrawal',
      error: err.message
    });
  }
});

// Get withdrawal details (for admin or user)
router.get('/withdraw/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Only admin or the user themselves can view
    if (req.user._id.toString() !== userId && req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: 'Forbidden: Can only view your own withdrawals'
      });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      Transaction.find({
        userId,
        type: 'WITHDRAWAL'
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments({ userId, type: 'WITHDRAWAL' })
    ]);

    res.json({
      success: true,
      statusCode: 200,
      message: 'Withdrawal history retrieved',
      data: transactions,
      pagination: {
        total,
        page,
        limit
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to get withdrawal history',
      error: err.message
    });
  }
});

module.exports = router;
