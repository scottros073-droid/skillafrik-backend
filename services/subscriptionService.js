/**
 * Subscription Service
 * Manages AI subscription plans, activation, and expiration
 */

const User = require('../models/User');
const Payment = require('../models/Payment');

const SUBSCRIPTION_PLANS = {
  monthly: {
    name: 'Monthly Plan',
    price_ngn: 1000,
    price_usd: 1,
    duration_days: 30,
    unlimited_ai: true
  },
  yearly: {
    name: 'Yearly Plan',
    price_ngn: 20000,
    price_usd: 20,
    duration_days: 365,
    unlimited_ai: true
  }
};

/**
 * Activate subscription for user after successful payment
 */
const activateSubscription = async (userId, planType) => {
  try {
    if (!Object.keys(SUBSCRIPTION_PLANS).includes(planType)) {
      throw new Error(`Invalid plan type: ${planType}`);
    }

    const plan = SUBSCRIPTION_PLANS[planType];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + plan.duration_days * 24 * 60 * 60 * 1000);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        subscriptionPlan: planType,
        subscriptionExpiresAt: expiresAt,
        aiUsageCount: 0, // Reset usage count on subscription
        aiLimit: 3 // Keep default limit for reference
      },
      { new: true }
    );

    return {
      success: true,
      message: `${plan.name} activated successfully`,
      data: {
        subscriptionPlan: updatedUser.subscriptionPlan,
        subscriptionExpiresAt: updatedUser.subscriptionExpiresAt,
        daysRemaining: Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000))
      }
    };
  } catch (error) {
    console.error('Subscription activation error:', error);
    throw error;
  }
};

/**
 * Get subscription status for user
 */
const getSubscriptionStatus = async (userId) => {
  try {
    const user = await User.findById(userId).select(
      'subscriptionPlan subscriptionExpiresAt aiUsageCount aiLimit'
    );

    if (!user) {
      throw new Error('User not found');
    }

    const now = new Date();
    const isActive = user.subscriptionPlan !== 'free' &&
      user.subscriptionExpiresAt &&
      now < user.subscriptionExpiresAt;

    let daysRemaining = 0;
    if (isActive && user.subscriptionExpiresAt) {
      daysRemaining = Math.ceil((user.subscriptionExpiresAt - now) / (24 * 60 * 60 * 1000));
    }

    return {
      subscriptionPlan: user.subscriptionPlan,
      isActive,
      expiresAt: user.subscriptionExpiresAt,
      daysRemaining,
      aiUsageCount: user.aiUsageCount,
      aiLimit: user.aiLimit,
      freeUsageRemaining: Math.max(0, user.aiLimit - user.aiUsageCount),
      unlimitedAIAccess: isActive
    };
  } catch (error) {
    console.error('Get subscription status error:', error);
    throw error;
  }
};

/**
 * Cancel subscription for user
 */
const cancelSubscription = async (userId) => {
  try {
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        subscriptionPlan: 'free',
        subscriptionExpiresAt: null,
        aiUsageCount: 0
      },
      { new: true }
    );

    return {
      success: true,
      message: 'Subscription cancelled successfully',
      subscriptionPlan: updatedUser.subscriptionPlan
    };
  } catch (error) {
    console.error('Cancel subscription error:', error);
    throw error;
  }
};

/**
 * Check and expire subscriptions that have passed their end date
 */
const checkExpiredSubscriptions = async () => {
  try {
    const now = new Date();
    
    // Find users with expired subscriptions
    const expiredUsers = await User.updateMany(
      {
        subscriptionPlan: { $in: ['monthly', 'yearly'] },
        subscriptionExpiresAt: { $lt: now }
      },
      {
        subscriptionPlan: 'free',
        subscriptionExpiresAt: null,
        aiUsageCount: 0
      }
    );

    return expiredUsers;
  } catch (error) {
    console.error('Check expired subscriptions error:', error);
  }
};

/**
 * Get pricing information
 */
const getPricing = () => {
  return {
    monthly: SUBSCRIPTION_PLANS.monthly,
    yearly: SUBSCRIPTION_PLANS.yearly,
    freeLimit: 3,
    freeDescription: '3 free AI requests'
  };
};

module.exports = {
  SUBSCRIPTION_PLANS,
  activateSubscription,
  getSubscriptionStatus,
  cancelSubscription,
  checkExpiredSubscriptions,
  getPricing
};
