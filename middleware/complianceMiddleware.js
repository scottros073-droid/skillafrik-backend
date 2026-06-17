// backend/middleware/complianceMiddleware.js

const ViolationLog = require('../models/ViolationLog');
const User = require('../models/User');

// Compliance engine - detects violations in text
const complianceEngine = (text) => {
  const violations = [];

  // Phone numbers (Nigerian and international formats)
  const phoneRegex = /(\+?[0-9]{1,3}[-.\s]?)?(\(?[0-9]{3}\)?[-.\s]?)?[0-9]{3}[-.\s]?[0-9]{4}/g;
  if (phoneRegex.test(text)) {
    violations.push({
      type: 'phone_number',
      reason: 'Phone numbers not allowed in messages'
    });
  }

  // Email addresses
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  if (emailRegex.test(text)) {
    violations.push({
      type: 'email',
      reason: 'Email addresses not allowed in messages'
    });
  }

  // External platforms
  const platforms = ['whatsapp', 'telegram', 'instagram', 'facebook', 'discord', 'slack', 'skype', 'viber', 'tiktok', 'youtube', 'snapchat'];
  const platformRegex = new RegExp(`(${platforms.join('|')})`, 'gi');
  if (platformRegex.test(text)) {
    violations.push({
      type: 'external_platform',
      reason: 'External platform contact not allowed'
    });
  }

  // Contact exchange requests
  const contactExchangeRegex = /contact\s+me|reach\s+me|message\s+me|dm\s+me|call\s+me|text\s+me|get\s+in\s+touch/gi;
  if (contactExchangeRegex.test(text)) {
    violations.push({
      type: 'contact_exchange',
      reason: 'Contact exchange not allowed in platform'
    });
  }

  // Prohibited phrases (escrow/payment bypass attempts)
  const prohibitedPhrases = [
    'pay outside',
    'send money outside',
    'transfer outside platform',
    'bypass escrow',
    'avoid fees',
    'no platform commission'
  ];
  const prohibitedRegex = new RegExp(`(${prohibitedPhrases.join('|')})`, 'gi');
  if (prohibitedRegex.test(text)) {
    violations.push({
      type: 'prohibited_phrase',
      reason: 'Prohibited content detected'
    });
  }

  return violations;
};

// Middleware to check message compliance
const complianceMiddleware = async (req, res, next) => {
  const { content } = req.body;
  const userId = req.user?._id;

  if (!content) {
    return next();
  }

  const violations = complianceEngine(content);

  if (violations.length > 0) {
    // Log violation
    try {
      // Check if this is a repeat violation
      const recentViolations = await ViolationLog.countDocuments({
        userId,
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
      });

      const isRepeatOffender = recentViolations >= 3;

      await ViolationLog.create({
        userId,
        violationType: violations[0].type,
        messageContent: content,
        actionTaken: 'blocked',
        isRepeatViolation: isRepeatOffender,
        violationCountIn30Days: recentViolations + 1
      });

      // Update user violation count
      await User.findByIdAndUpdate(userId, {
        violationCount: (await User.findById(userId)).violationCount + 1,
        lastViolationDate: new Date(),
        isRepeatOffender: isRepeatOffender
      });

      // If repeat offender and reaches threshold, suspend account
      if (isRepeatOffender && recentViolations >= 4) {
        await User.findByIdAndUpdate(userId, {
          status: 'suspended',
          suspensionReason: 'Multiple policy violations'
        });

        return res.status(403).json({
          success: false,
          statusCode: 403,
          message: 'Message blocked and account suspended due to policy violations'
        });
      }

      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: 'Message blocked: Policy violation detected',
        violation: violations[0]
      });
    } catch (err) {
      console.error('Compliance middleware error:', err);
      // Fall through to next middleware if logging fails
      next();
    }
  } else {
    next();
  }
};

module.exports = { complianceMiddleware, complianceEngine };
