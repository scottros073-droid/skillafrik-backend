const User = require('../models/User');

const isFutureDate = (value) => {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date > new Date();
};

const hasPremiumAIAccess = (user) => {
  if (!user) return false;

  const hasActiveExpiry = isFutureDate(user.subscriptionExpiresAt) || isFutureDate(user.premiumExpiryDate);
  const hasExpiredPremium =
    (user.subscriptionExpiresAt && !isFutureDate(user.subscriptionExpiresAt)) ||
    (user.premiumExpiryDate && !isFutureDate(user.premiumExpiryDate));

  if (hasActiveExpiry) return true;
  if (hasExpiredPremium) return false;

  return Boolean(
    user.isPremium ||
    user.premium ||
    user.subscription === 'premium' ||
    user.subscription === 'professional' ||
    (user.subscriptionPlan && user.subscriptionPlan !== 'free')
  );
};

const aiFeatureEnabled = (feature) => {
  const flagName = `ENABLE_AI_${String(feature || '').toUpperCase()}`;
  return process.env[flagName] !== 'false';
};

const requireAIFeature = (feature) => (req, res, next) => {
  if (aiFeatureEnabled(feature)) return next();

  return res.status(503).json({
    success: false,
    message: 'AI feature is temporarily unavailable.',
    data: {
      unavailable: true,
      feature
    }
  });
};

const aiUsageMiddleware = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const user = await User.findById(userId).select(
      'aiUsageCount isPremium premium premiumExpiryDate subscription subscriptionPlan subscriptionExpiresAt'
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!hasPremiumAIAccess(user)) {
      return res.status(403).json({
        success: false,
        message: 'Premium required. Upgrade to use AI tools.',
        data: {
          upgradeRequired: true,
          canUseAI: false,
          remaining: 0
        }
      });
    }

    req.aiAccess = {
      allowed: true,
      reason: 'premium',
      subscriptionPlan: user.subscriptionPlan,
      expiresAt: user.subscriptionExpiresAt || user.premiumExpiryDate
    };

    return next();
  } catch (error) {
    console.error('AI access check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to verify AI access right now.'
    });
  }
};

const incrementAiUsage = async (req, res, next = () => {}) => {
  try {
    if (req.aiAccess?.allowed) {
      const userId = req.user?._id || req.user?.id;
      await User.findByIdAndUpdate(userId, { $inc: { aiUsageCount: 1 } });
    }
  } catch (error) {
    console.error('AI usage increment error:', error);
  }

  return next();
};

module.exports = {
  aiUsageMiddleware,
  hasPremiumAIAccess,
  requireAIFeature,
  incrementAiUsage
};
