/**
 * Monetization Routes
 * Endpoints for payments, wallet management, job boosts, premium tiers, and AI credits
 */

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const monetizationService = require('../services/monetizationService');
const Wallet = require('../models/Wallet');

// ===== MIDDLEWARE =====
// All monetization routes require authentication
router.use(authMiddleware);

// ===== WALLET ENDPOINTS =====

/**
 * GET /api/monetization/wallet
 * Get user's wallet information
 */
router.get('/wallet', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const wallet = await monetizationService.getOrCreateWallet(userId);
    
    res.json({
      success: true,
      data: {
        availableBalance: wallet.availableBalance,
        escrowBalance: wallet.escrowBalance,
        totalBalance: wallet.availableBalance + wallet.escrowBalance,
        totalEarnings: wallet.totalEarnings,
        totalWithdrawn: wallet.totalWithdrawn
      }
    });
  } catch (error) {
    console.error('[MONETIZATION] Wallet error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get wallet'
    });
  }
});

// ===== ACCOUNT VERIFICATION =====

/**
 * POST /api/monetization/verify-account
 * Verify bank account for withdrawals
 */
router.post('/verify-account', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { accountNumber, bankCode, accountName } = req.body;
    
    if (!accountNumber || !bankCode || !accountName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: accountNumber, bankCode, accountName'
      });
    }
    
    const result = await monetizationService.verifyAccount(
      userId,
      accountNumber,
      bankCode,
      accountName
    );
    
    res.json(result);
  } catch (error) {
    console.error('[MONETIZATION] Account verification error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to verify account'
    });
  }
});

// ===== JOB MONETIZATION =====

/**
 * POST /api/monetization/boost-job
 * Boost a job for 7 days
 */
router.post('/boost-job', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { jobId } = req.body;
    
    if (!jobId) {
      return res.status(400).json({
        success: false,
        message: 'Missing jobId'
      });
    }
    
    const result = await monetizationService.boostJob(userId, jobId);
    
    res.json(result);
  } catch (error) {
    console.error('[MONETIZATION] Boost job error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to boost job'
    });
  }
});

/**
 * POST /api/monetization/feature-job
 * Feature a job on homepage for 30 days
 */
router.post('/feature-job', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { jobId } = req.body;
    
    if (!jobId) {
      return res.status(400).json({
        success: false,
        message: 'Missing jobId'
      });
    }
    
    const result = await monetizationService.featureJob(userId, jobId);
    
    res.json(result);
  } catch (error) {
    console.error('[MONETIZATION] Feature job error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to feature job'
    });
  }
});

// ===== PREMIUM SUBSCRIPTION =====

/**
 * POST /api/monetization/subscribe-premium
 * Subscribe to premium tier
 */
router.post('/subscribe-premium', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { planType = 'basic' } = req.body;
    
    const result = await monetizationService.subscribePremium(userId, planType);
    
    res.json(result);
  } catch (error) {
    console.error('[MONETIZATION] Premium subscription error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to subscribe to premium'
    });
  }
});

// ===== AI CREDITS =====

/**
 * POST /api/monetization/purchase-ai-credits
 * Purchase AI credits
 */
router.post('/purchase-ai-credits', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { packageType = 'starter' } = req.body;
    
    const result = await monetizationService.purchaseAICredits(userId, packageType);
    
    res.json(result);
  } catch (error) {
    console.error('[MONETIZATION] Purchase AI credits error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to purchase AI credits'
    });
  }
});

/**
 * GET /api/monetization/ai-credits
 * Get AI credits status
 */
router.get('/ai-credits', async (req, res) => {
  try {
    const User = require('../models/User');
    const userId = req.user.id || req.user._id;
    
    const user = await User.findById(userId).select('aiCredits');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        credits: user.aiCredits || 0,
        packages: monetizationService.PRICING.aiCredits
      }
    });
  } catch (error) {
    console.error('[MONETIZATION] Get AI credits error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get AI credits'
    });
  }
});

// ===== PAYOUTS =====

/**
 * POST /api/monetization/initiate-payout
 * Initiate payout to freelancer
 */
router.post('/initiate-payout', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { amount, bankDetails } = req.body;
    
    if (!amount || !bankDetails) {
      return res.status(400).json({
        success: false,
        message: 'Missing amount or bankDetails'
      });
    }
    
    const result = await monetizationService.initiatePayout(userId, amount, bankDetails);
    
    res.json(result);
  } catch (error) {
    console.error('[MONETIZATION] Initiate payout error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to initiate payout'
    });
  }
});

// ===== PRICING INFO =====

/**
 * GET /api/monetization/pricing
 * Get all pricing information
 */
router.get('/pricing', (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        jobBoost: monetizationService.PRICING.jobBoost,
        jobFeature: monetizationService.PRICING.jobFeature,
        premiumTiers: monetizationService.PRICING.premiumTier,
        aiCredits: monetizationService.PRICING.aiCredits
      }
    });
  } catch (error) {
    console.error('[MONETIZATION] Pricing error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get pricing'
    });
  }
});

// ===== COMMISSION CALCULATOR =====

/**
 * POST /api/monetization/calculate-commission
 * Calculate platform commission on amount
 */
router.post('/calculate-commission', async (req, res) => {
  try {
    const { amount, tier = 'standard' } = req.body;
    
    if (!amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing amount'
      });
    }
    
    const result = monetizationService.calculateCommission(amount, tier);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[MONETIZATION] Commission calculation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate commission'
    });
  }
});

module.exports = router;
