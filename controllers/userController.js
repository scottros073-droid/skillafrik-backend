// backend/controllers/userController.js

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Portfolio = require('../models/Portfolio');

const parseSkills = (skills) => {
  if (!skills) return undefined;
  if (Array.isArray(skills)) return skills.map((skill) => String(skill).trim()).filter(Boolean);
  if (typeof skills === 'string') {
    try {
      const parsed = JSON.parse(skills);
      if (Array.isArray(parsed)) return parseSkills(parsed);
    } catch {}
    return skills.split(',').map((skill) => skill.trim()).filter(Boolean);
  }
  return undefined;
};

const parseStringList = (value) => {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parseStringList(parsed);
    } catch {}
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return undefined;
};

const buildFileUrl = (req, file) => {
  if (!file) return null;
  const ext = file.mimetype === 'image/png'
    ? 'png'
    : file.mimetype === 'image/webp'
    ? 'webp'
    : file.mimetype === 'image/gif'
    ? 'gif'
    : 'jpg';
  const base64 = file.buffer.toString('base64');
  return `data:image/${ext};base64,${base64}`;
};

// ===== GET USER PROFILE =====
exports.getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('wallet')
      .populate('portfolio')
      .select('-password');

    res.json({
      success: true,
      statusCode: 200,
      message: 'Profile retrieved',
      data: user.toJSON()
    });
  } catch (err) {
    console.error('Get profile error:', err);
    res.json({
      success: false,
      message: 'Failed to get profile'
    });
  }
};

// ===== UPDATE USER PROFILE =====
exports.updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, title, purpose, bio, about, avatar, hourlyRate, experience, education, location } = req.body || {};
    const parsedSkills = parseSkills(req.body?.skills);
    const parsedLanguages = parseStringList(req.body?.languages);
    const parsedPortfolioLinks = parseStringList(req.body?.portfolioLinks || req.body?.portfolio_links);
    const uploadedAvatar = buildFileUrl(req, req.file);
    const locationValue = typeof location === 'string' ? location : (typeof purpose === 'string' ? purpose : undefined);

    const updateData = {};
    if (typeof firstName === 'string') updateData.firstName = firstName.trim();
    if (typeof lastName === 'string') updateData.lastName = lastName.trim();
    if (typeof title === 'string') updateData.title = title.trim();
    if (typeof locationValue === 'string') updateData.purpose = locationValue.trim();
    if (typeof bio === 'string' || typeof about === 'string') updateData.bio = String(bio || about).trim();
    if (parsedSkills) updateData.skills = parsedSkills;
    if (typeof experience === 'string') updateData.experience = experience.trim();
    if (typeof education === 'string') updateData.education = education.trim();
    if (parsedLanguages) updateData.languages = parsedLanguages;
    if (parsedPortfolioLinks) updateData.portfolioLinks = parsedPortfolioLinks;
    if (uploadedAvatar || avatar) updateData.avatar = uploadedAvatar || avatar;
    if (hourlyRate !== undefined && hourlyRate !== '') updateData.hourlyRate = Number(hourlyRate);

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      success: true,
      statusCode: 200,
      message: 'Profile updated',
      data: user.toJSON(),
      user: user.toJSON()
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(400).json({
      success: false,
      statusCode: 400,
      message: 'Failed to update profile',
      data: {},
      error: err.message
    });
  }
};

// ===== GET PUBLIC PROFILE =====
exports.getPublicProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .populate('portfolio')
      .select('-password -email -wallet -bankDetails');

    if (!user) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      statusCode: 200,
      message: 'Public profile retrieved',
      data: user.toJSON()
    });
  } catch (err) {
    console.error('Get public profile error:', err);
    res.json({
      success: false,
      statusCode: 500,
      message: 'Failed to get profile',
      data: {},
      error: err.message
    });
  }
};

// ===== GET ALL FREELANCERS =====
exports.getFreelancers = async (req, res) => {
  try {
    const { search, keyword, category, skill, minRate, maxRate, minRating } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 48);

    let query = { userType: 'freelancer' };

    const searchTerm = search || keyword;
    if (searchTerm) {
      query.$or = [
        { firstName: { $regex: searchTerm, $options: 'i' } },
        { lastName: { $regex: searchTerm, $options: 'i' } },
        { bio: { $regex: searchTerm, $options: 'i' } },
        { skills: { $regex: searchTerm, $options: 'i' } }
      ];
    }

    const skillTerm = skill || (category && category !== 'All Categories' ? category : '');
    if (skillTerm) {
      query.skills = { $in: [skillTerm] };
    }

    if (minRate || maxRate) {
      query.hourlyRate = {};
      if (minRate) query.hourlyRate.$gte = parseFloat(minRate);
      if (maxRate) query.hourlyRate.$lte = parseFloat(maxRate);
    }

    if (minRating) {
      query.rating = { $gte: Math.min(Math.max(parseFloat(minRating) || 0, 0), 5) };
    }

    const skip = (page - 1) * limit;
    const [freelancers, total] = await Promise.all([
      User.find(query)
      .select('firstName lastName avatar title purpose bio skills hourlyRate experience education languages portfolioLinks rating ratingCount reviewCount totalCompletedJobs totalEarnings isPremium isTopUser verified trustScore lastActive')
      .skip(skip)
      .limit(limit)
      .sort({ isTopUser: -1, isPremium: -1, rating: -1, totalCompletedJobs: -1, lastActive: -1 })
      .lean(),
      User.countDocuments(query)
    ]);
    const results = freelancers || [];

    res.status(200).json({ 
      success: true, 
      data: results.map((f) => ({ ...f, role: 'freelancer', userType: 'freelancer', isVerified: Boolean(f.verified) })),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('API ERROR:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message || 'Server error' 
    });
  }
};

// ===== GET FREELANCER BY ID =====
exports.getFreelancer = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id)
      .populate('portfolio')
      .select('-password -email -wallet -bankDetails');

    if (!user || user.userType !== 'freelancer') {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'Freelancer not found'
      });
    }

    res.json({
      success: true,
      statusCode: 200,
      message: 'Freelancer retrieved',
      data: user.toJSON()
    });
  } catch (err) {
    console.error('API ERROR:', err);
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: err.message || 'Failed to get freelancer'
    });
  }
};

// ===== GET FREELANCER SKILLS =====
exports.getSkills = async (req, res) => {
  try {
    const skills = await User.distinct('skills', { userType: 'freelancer' });
    res.json({
      success: true,
      statusCode: 200,
      message: 'Skills retrieved',
      data: skills.sort()
    });
  } catch (err) {
    console.error('Get skills error:', err);
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to get skills',
      error: err.message
    });
  }
};

// ===== UPDATE BANK DETAILS =====
exports.updateBankDetails = async (req, res) => {
  try {
    const { accountNumber, bankCode, accountName } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        bankDetails: {
          accountNumber,
          bankCode,
          accountName
        }
      },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      statusCode: 200,
      message: 'Bank details updated',
      data: user.toJSON()
    });
  } catch (err) {
    console.error('Update bank details error:', err);
    res.status(400).json({
      success: false,
      statusCode: 400,
      message: 'Failed to update bank details',
      error: err.message
    });
  }
};

// ===== DELETE ACCOUNT =====
exports.deleteAccount = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const logger = require('../utils/logger');

    if (!userId) {
      return res.status(401).json({
        success: false,
        statusCode: 401,
        message: 'User not authenticated'
      });
    }

    logger.info('🗑️  Account deletion initiated', { userId });

    // Fetch user to verify they exist
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'User not found'
      });
    }

    const userEmail = user.email;

    // Delete associated records
    try {
      // Delete wallet
      if (user.wallet) {
        await Wallet.deleteMany({ userId });
        logger.info('✅ Wallet deleted', { userId });
      }

      // Delete portfolio
      if (user.portfolio) {
        await Portfolio.deleteMany({ userId });
        logger.info('✅ Portfolio deleted', { userId });
      }

      // Delete notifications
      const Notification = require('../models/Notification');
      await Notification.deleteMany({ userId });
      logger.info('✅ Notifications deleted', { userId });

      // Delete refresh tokens
      const RefreshToken = require('../models/RefreshToken');
      await RefreshToken.deleteMany({ userId });
      logger.info('✅ Refresh tokens deleted', { userId });

      // Delete gamification records
      const Gamification = require('../models/Gamification');
      await Gamification.deleteMany({ userId });
      logger.info('✅ Gamification records deleted', { userId });

      // Delete chat/message records
      const Message = require('../models/Message');
      const Chat = require('../models/Chat');
      await Message.deleteMany({ $or: [{ from: userId }, { to: userId }] });
      await Chat.deleteMany({ participants: userId });
      logger.info('✅ Chat and messages deleted', { userId });

      // Delete the user account
      await User.deleteOne({ _id: userId });
      logger.info('✅ User account deleted', { userId, email: userEmail });

    } catch (cleanupError) {
      logger.error('❌ Error during account cleanup', {
        userId,
        error: cleanupError.message
      });
      // Continue with user deletion even if cleanup fails
    }

    logger.info('✅ Account deletion completed successfully', { userId, email: userEmail });

    res.json({
      success: true,
      statusCode: 200,
      message: 'Account deleted successfully. Your data has been removed from our system.',
      data: { userId, email: userEmail }
    });
  } catch (err) {
    console.error('Delete account error:', err);
    const logger = require('../utils/logger');
    logger.error('❌ Failed to delete account', {
      userId: req.user?._id || req.user?.id,
      error: err.message
    });

    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to delete account. Please try again later.',
      error: err.message
    });
  }
};
