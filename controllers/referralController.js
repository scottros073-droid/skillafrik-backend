const crypto = require('crypto');
const Referral = require('../models/Referral');
const User = require('../models/User');

exports.getMyReferral = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.referralCode) {
      user.referralCode = `SKILL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      await user.save();
    }

    const invites = await Referral.countDocuments({ referrerId: user._id });
    const frontendUrl = process.env.FRONTEND_URL;

    if (!frontendUrl) {
      console.error('❌ Missing FRONTEND_URL for referral links');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error: FRONTEND_URL is required'
      });
    }

    res.json({
      success: true,
      data: {
        code: user.referralCode,
        invites,
        referralLink: `${frontendUrl.replace(/\/+$/u, '')}/signup?ref=${user.referralCode}`
      }
    });
  } catch (err) {
    console.error('Get referral info error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve referral info' });
  }
};

exports.inviteFriend = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.referralCode) {
      user.referralCode = `SKILL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      await user.save();
    }

    const referral = await Referral.create({
      referrerId: user._id,
      referralCode: user.referralCode,
      referredEmail: req.body.email || null,
      status: 'pending'
    });

    const invites = await Referral.countDocuments({ referrerId: user._id });
    const rewardAdded = invites >= 3;

    res.json({
      success: true,
      data: {
        invited: invites,
        rewardAdded,
        referralId: referral._id
      }
    });
  } catch (err) {
    console.error('Invite friend error:', err);
    res.status(500).json({ success: false, message: 'Failed to invite friend' });
  }
};
