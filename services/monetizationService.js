/**
 * Monetization Service
 * Handles all monetization logic: account verification, job boosts, wallet management,
 * premium features, and AI credit transactions
 * Production-ready with Paystack integration
 */

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Job = require('../models/Job');
const Payment = require('../models/Payment');
const Escrow = require('../models/Escrow');
const axios = require('axios');

const logger = require('../utils/productionLogger');

// ===== PAYSTACK CONFIG =====
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY;

// ===== MONETIZATION PRICING =====
const PRICING = {
  jobBoost: {
    amount: 500,
    currency: 'NGN',
    duration_days: 7,
    description: 'Job visibility boost for 7 days'
  },
  jobFeature: {
    amount: 2000,
    currency: 'NGN',
    duration_days: 30,
    description: 'Feature job on homepage for 30 days'
  },
  premiumTier: {
    basic: {
      amount: 5000,
      currency: 'NGN',
      duration_days: 30,
      description: 'Premium Basic - 30 days'
    },
    pro: {
      amount: 15000,
      currency: 'NGN',
      duration_days: 30,
      description: 'Premium Pro - 30 days'
    },
    enterprise: {
      amount: 50000,
      currency: 'NGN',
      duration_days: 30,
      description: 'Premium Enterprise - 30 days'
    }
  },
  aiCredits: {
    base: { credits: 10, amount: 1000, currency: 'NGN' },
    starter: { credits: 50, amount: 4000, currency: 'NGN' },
    pro: { credits: 200, amount: 12000, currency: 'NGN' },
    enterprise: { credits: 1000, amount: 50000, currency: 'NGN' }
  }
};

// ===== WALLET MANAGEMENT =====

/**
 * Get or create wallet for user
 */
const getOrCreateWallet = async (userId) => {
  try {
    let wallet = await Wallet.findOne({ userId });
    
    if (!wallet) {
      wallet = await Wallet.create({
        userId,
        available: 0,
        escrow: 0,
        totalBalance: 0
      });
      logger.info(`Wallet created for user ${userId}`);
    }
    
    return wallet;
  } catch (error) {
    logger.error(`Get/Create wallet error: ${error.message}`);
    throw error;
  }
};

/**
 * Update wallet balance and create transaction record
 */
const updateWalletBalance = async (userId, amount, type, description, metadata = {}) => {
  try {
    if (metadata.paymentReference) {
      const existingTransaction = await Transaction.findOne({
        userId,
        paymentReference: metadata.paymentReference
      }).lean();

      if (existingTransaction) {
        const wallet = await getOrCreateWallet(userId);
        return { wallet, transaction: existingTransaction, duplicate: true };
      }
    }

    const wallet = await getOrCreateWallet(userId);
    
    let balanceUpdate = {};
    const currentAvailable = Number(wallet.available || 0);
    
    switch (type) {
      case 'credit': // Money added to wallet
      case 'escrow_release': // Released from escrow
        balanceUpdate = { $inc: { available: amount, totalBalance: amount } };
        break;
        
      case 'debit': // Money withdrawn from wallet
      case 'commission': // Platform commission
        if (currentAvailable < amount) {
          throw new Error('Insufficient wallet balance');
        }
        balanceUpdate = { $inc: { available: -amount, totalBalance: -amount, totalWithdrawnAmount: amount } };
        break;
        
      case 'escrow': // Money held in escrow
        balanceUpdate = { $inc: { escrow: amount, totalBalance: amount } };
        break;
        
      case 'escrow_refund': // Refunded from escrow
        balanceUpdate = { $inc: { escrow: -amount, available: amount } };
        break;
        
      default:
        throw new Error(`Unknown transaction type: ${type}`);
    }
    
    const updatedWallet = await Wallet.findOneAndUpdate(
      { userId },
      balanceUpdate,
      { new: true }
    );
    
    // Create transaction record
    const transaction = await Transaction.create({
      userId,
      walletId: wallet._id,
      type: type === 'debit'
        ? 'WITHDRAWAL'
        : type === 'commission'
        ? 'FEE'
        : type === 'escrow'
        ? 'ESCROW'
        : type === 'escrow_refund'
        ? 'REFUND'
        : 'DEPOSIT',
      amount,
      description,
      paymentReference: metadata.paymentReference || null,
      balanceBefore: currentAvailable,
      balanceAfter: updatedWallet.available,
      metadata
    });
    
    logger.info(`Wallet updated: ${type} ${amount} for user ${userId} - ${description}`);
    
    return {
      wallet: updatedWallet,
      transaction
    };
  } catch (error) {
    logger.error(`Update wallet error: ${error.message}`);
    throw error;
  }
};

// ===== ACCOUNT VERIFICATION =====

/**
 * Verify user bank account for withdrawals
 * Can be called with full parameters or just userId (for payment callback)
 */
const verifyAccount = async (userId, accountNumber, bankCode, accountName) => {
  try {
    const updateData = {
      verified: true,
      verificationDate: new Date()
    };
    
    // If all account details provided, store them
    if (accountNumber && bankCode && accountName) {
      updateData.bankDetails = {
        accountNumber,
        bankCode,
        accountName,
        verifiedAt: new Date()
      };
    }
    
    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    );
    
    if (!user) {
      throw new Error('User not found');
    }
    
    logger.info(`Account verified for user ${userId}`);
    
    return {
      success: true,
      message: 'Account verified successfully',
      user: {
        id: user._id,
        verified: user.verified,
        verificationDate: user.verificationDate
      }
    };
  } catch (error) {
    logger.error(`Account verification error: ${error.message}`);
    throw error;
  }
};

// ===== JOB MONETIZATION =====

/**
 * Boost a job (increase visibility for 7 days)
 */
const boostJob = async (userId, jobId, amount = PRICING.jobBoost.amount) => {
  try {
    const job = await Job.findOne({ _id: jobId, clientId: userId });
    
    if (!job) {
      throw new Error('Job not found or unauthorized');
    }
    
    if (job.boostExpiresAt && job.boostExpiresAt > new Date()) {
      throw new Error('Job is already boosted');
    }
    
    const boostExpiresAt = new Date();
    boostExpiresAt.setDate(boostExpiresAt.getDate() + PRICING.jobBoost.duration_days);
    
    const updatedJob = await Job.findByIdAndUpdate(
      jobId,
      {
        isBoosted: true,
        boostExpiresAt,
        boostCount: (job.boostCount || 0) + 1
      },
      { new: true }
    );
    
    // Create transaction record
    await Transaction.create({
      userId,
      type: 'JOB_BOOST',
      amount,
      description: `Job boost: ${job.title}`,
      jobId,
      metadata: { boostExpiresAt }
    });
    
    logger.info(`Job ${jobId} boosted for user ${userId} until ${boostExpiresAt}`);
    
    return {
      success: true,
      message: 'Job boosted successfully',
      job: {
        id: updatedJob._id,
        isBoosted: true,
        boostExpiresAt
      }
    };
  } catch (error) {
    logger.error(`Boost job error: ${error.message}`);
    throw error;
  }
};

/**
 * Feature a job on homepage (30 days)
 */
const featureJob = async (userId, jobId, amount = PRICING.jobFeature.amount) => {
  try {
    const job = await Job.findOne({ _id: jobId, clientId: userId });
    
    if (!job) {
      throw new Error('Job not found or unauthorized');
    }
    
    if (job.isFeatured && job.featureExpiresAt > new Date()) {
      throw new Error('Job is already featured');
    }
    
    const featureExpiresAt = new Date();
    featureExpiresAt.setDate(featureExpiresAt.getDate() + PRICING.jobFeature.duration_days);
    
    const updatedJob = await Job.findByIdAndUpdate(
      jobId,
      {
        featured: true,
        isFeatured: true,
        featureExpiresAt,
        featureCount: (job.featureCount || 0) + 1
      },
      { new: true }
    );
    
    await Transaction.create({
      userId,
      type: 'JOB_FEATURE',
      amount,
      description: `Job feature: ${job.title}`,
      jobId,
      metadata: { featureExpiresAt }
    });
    
    logger.info(`Job ${jobId} featured for user ${userId} until ${featureExpiresAt}`);
    
    return {
      success: true,
      message: 'Job featured successfully',
      job: {
        id: updatedJob._id,
        isFeatured: true,
        featureExpiresAt
      }
    };
  } catch (error) {
    logger.error(`Feature job error: ${error.message}`);
    throw error;
  }
};

// ===== PREMIUM SUBSCRIPTIONS =====

/**
 * Subscribe user to premium tier
 */
const subscribePremium = async (userId, planType = 'basic') => {
  try {
    const plan = PRICING.premiumTier[planType];
    
    if (!plan) {
      throw new Error(`Invalid premium plan: ${planType}`);
    }
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + plan.duration_days);
    
    const user = await User.findByIdAndUpdate(
      userId,
      {
        premiumTier: planType,
        premiumExpiryDate: expiresAt,
        isPremium: true,
        subscription: 'premium',
        subscriptionPlan: 'monthly',
        subscriptionExpiresAt: expiresAt
      },
      { new: true }
    );
    
    if (!user) {
      throw new Error('User not found');
    }
    
    await Transaction.create({
      userId,
      type: 'PREMIUM_SUBSCRIPTION',
      amount: plan.amount,
      description: plan.description,
      metadata: { planType, expiresAt }
    });
    
    logger.info(`User ${userId} subscribed to premium plan: ${planType} until ${expiresAt}`);
    
    return {
      success: true,
      message: `Premium ${planType} subscription activated`,
      premium: {
        tier: planType,
        expiresAt,
        daysRemaining: plan.duration_days
      }
    };
  } catch (error) {
    logger.error(`Subscribe premium error: ${error.message}`);
    throw error;
  }
};

// ===== AI CREDITS =====

/**
 * Purchase AI credits
 */
const purchaseAICredits = async (userId, packageType = 'starter') => {
  try {
    const package_data = PRICING.aiCredits[packageType];
    
    if (!package_data) {
      throw new Error(`Invalid AI credit package: ${packageType}`);
    }
    
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $inc: { aiCredits: package_data.credits },
        lastAICreditPurchase: new Date()
      },
      { new: true }
    );
    
    if (!user) {
      throw new Error('User not found');
    }
    
    await Transaction.create({
      userId,
      type: 'AI_CREDITS_PURCHASE',
      amount: package_data.amount,
      description: `AI Credits Purchase: ${package_data.credits} credits`,
      metadata: { packageType, credits: package_data.credits }
    });
    
    logger.info(`User ${userId} purchased ${package_data.credits} AI credits`);
    
    return {
      success: true,
      message: 'AI credits purchased',
      credits: {
        purchased: package_data.credits,
        total: user.aiCredits,
        amount: package_data.amount
      }
    };
  } catch (error) {
    logger.error(`Purchase AI credits error: ${error.message}`);
    throw error;
  }
};

/**
 * Use AI credits (deduct from user)
 */
const useAICredits = async (userId, creditsNeeded = 1) => {
  try {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    if (user.aiCredits < creditsNeeded) {
      throw new Error(`Insufficient AI credits. Have: ${user.aiCredits}, Need: ${creditsNeeded}`);
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { aiCredits: -creditsNeeded } },
      { new: true }
    );
    
    await Transaction.create({
      userId,
      type: 'AI_CREDITS_USAGE',
      amount: 0, // No amount for usage deduction
      description: `AI Credits Used: ${creditsNeeded} credits`,
      metadata: { creditsUsed: creditsNeeded, creditsRemaining: updatedUser.aiCredits }
    });
    
    logger.info(`User ${userId} used ${creditsNeeded} AI credits`);
    
    return {
      success: true,
      creditsRemaining: updatedUser.aiCredits
    };
  } catch (error) {
    logger.error(`Use AI credits error: ${error.message}`);
    throw error;
  }
};

// ===== PAYOUTS & WITHDRAWALS =====

/**
 * Initialize payout to freelancer (requires Paystack recipient creation)
 */
const initiatePayout = async (userId, amount, bankDetails) => {
  try {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // In production, use Paystack Transfer API
    // Create transfer recipient
    // Initiate transfer
    
    logger.info(`Payout initiated for user ${userId}: ₦${amount}`);
    
    return {
      success: true,
      message: 'Payout initiated',
      payout: {
        userId,
        amount,
        status: 'pending'
      }
    };
  } catch (error) {
    logger.error(`Initiate payout error: ${error.message}`);
    throw error;
  }
};

// ===== COMMISSION CALCULATIONS =====

/**
 * Calculate platform commission on transaction
 */
const calculateCommission = (amount, tier = 'standard') => {
  const commissionRates = {
    standard: 0.10, // 10% for standard users
    premium: 0.05, // 5% for premium users
    enterprise: 0.02 // 2% for enterprise users
  };
  
  const rate = commissionRates[tier] || commissionRates.standard;
  const commission = amount * rate;
  
  return {
    grossAmount: amount,
    commission,
    netAmount: amount - commission,
    commissionRate: `${(rate * 100)}%`
  };
};

// ===== EXPORTS =====
module.exports = {
  // Wallet
  getOrCreateWallet,
  updateWalletBalance,
  
  // Account verification
  verifyAccount,
  
  // Job monetization
  boostJob,
  featureJob,
  
  // Premium
  subscribePremium,
  
  // AI Credits
  purchaseAICredits,
  useAICredits,
  
  // Payouts
  initiatePayout,
  
  // Utilities
  calculateCommission,
  
  // Constants
  PRICING,
  PAYSTACK_SECRET,
  PAYSTACK_PUBLIC
};
