const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const Job = require('../models/Job');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Payment = require('../models/Payment');
const Proposal = require('../models/Proposal');
const Notification = require('../models/Notification');
const Wallet = require('../models/Wallet');
const mongoose = require('mongoose');
const { readSummaryCache, writeSummaryCache } = require('../utils/summaryCache');
const { getClientApplicationStats } = require('../utils/clientApplicationStats');

const getSummaryCacheKey = (userId) => `summary:${String(userId)}`;

// USD conversion rate (1 NGN = 0.00066 USD approximately, but we'll use 1:1 for simplicity)
const USD_RATE = 1;

// Convert amount to USD format
const toUSD = (amount) => `$${(amount * USD_RATE).toFixed(2)}`;

const isValidMongoId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const buildEmptyDashboardPayload = (user = {}) => ({
  stats: {
    jobsPosted: 0,
    jobsCompleted: 0,
    activeJobs: 0,
    contracts: 0,
    proposals: 0,
    applicationsReceived: 0,
    unreadApplications: 0,
    totalEarnings: toUSD(0),
    wallet: 0,
    escrow: 0,
    rating: 0,
    profileComplete: user?.email ? 40 : 0
  },
  activities: [],
  notifications: [],
  latestApplicants: [],
  analytics: {},
  wallet: {
    available: 0,
    escrow: 0,
    total: 0
  },
  user: {
    name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.name || 'User',
    email: user?.email,
    role: user?.role,
    avatar: user?.avatar
  }
});

const buildDashboardOverview = async (userId) => {
  if (!isValidMongoId(userId)) return buildEmptyDashboardPayload({});

  const [
    user,
    jobsPosted,
    jobsCompleted,
    activeJobs,
    proposals,
    transactions,
    notifications,
    wallet
  ] = await Promise.all([
    User.findById(userId).select('firstName lastName email role userType avatar rating').lean(),
    Job.countDocuments({ createdBy: userId }),
    Job.countDocuments({ freelancerId: userId, status: 'completed' }),
    Job.countDocuments({
      $or: [{ createdBy: userId }, { freelancerId: userId }],
      status: { $in: ['open', 'in_progress', 'pending'] }
    }),
    Proposal.countDocuments({ freelancerId: userId }),
    Transaction.find({ userId }).select('type amount description createdAt').sort({ createdAt: -1 }).limit(10).lean(),
    Notification.find({ userId, read: false }).select('title message type createdAt').sort({ createdAt: -1 }).limit(5).lean(),
    Wallet.findOne({ userId }).select('available escrow totalBalance').lean()
  ]);

  const totalEarnings = transactions
    .filter((t) => t.type === 'RELEASE' || t.type === 'credit')
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const isClient = String(user?.userType || user?.role || '').toLowerCase() === 'client';
  const clientApplications = isClient ? await getClientApplicationStats(userId) : {
    applicationsReceived: 0,
    unreadApplications: 0,
    latestApplicants: [],
  };

  const stats = {
    jobsPosted,
    jobsCompleted,
    activeJobs,
    proposals,
    applicationsReceived: clientApplications.applicationsReceived,
    unreadApplications: clientApplications.unreadApplications,
    totalEarnings: toUSD(totalEarnings),
    wallet: wallet?.available || 0,
    escrow: wallet?.escrow || 0,
    rating: user?.rating || 0,
    profileComplete: user ? 70 : 0
  };

  const activities = transactions.slice(0, 5).map((t) => ({
    id: t._id,
    type: t.type,
    amount: toUSD(t.amount),
    description: t.description || t.type,
    date: t.createdAt
  }));

  return {
    stats,
    activities,
    latestApplicants: clientApplications.latestApplicants,
    notifications: notifications.map((n) => ({
      id: n._id,
      title: n.title,
      message: n.message,
      type: n.type,
      createdAt: n.createdAt
    })),
    wallet: {
      available: wallet?.available || 0,
      escrow: wallet?.escrow || 0,
      total: wallet?.totalBalance || 0
    },
    user: {
      name: user ? `${user.firstName} ${user.lastName}` : 'User',
      email: user?.email,
      role: user?.role,
      avatar: user?.avatar
    }
  };
};

const sendDashboardResponse = async (req, res) => {
  try {
    const userId = req.user._id;
    if (!isValidMongoId(userId)) {
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({ success: true, data: buildEmptyDashboardPayload(req.user) });
    }
    const cacheKey = getSummaryCacheKey(userId);
    const cached = readSummaryCache(userId);

    if (cached) {
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({ success: true, cached: true, data: cached });
    }

    const data = await buildDashboardOverview(userId);
    writeSummaryCache(userId, data);
    res.set('Cache-Control', 'private, no-store');
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Dashboard overview error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

router.get('/', authMiddleware, sendDashboardResponse);
router.get('/overview', authMiddleware, sendDashboardResponse);

// Get dashboard metadata for layout and notification badges
router.get('/meta', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    if (!isValidMongoId(userId)) {
      return res.json({
        success: true,
        data: {
          notifications: 0,
          latestNotifications: []
        }
      });
    }

    const [unreadCount, latestNotifications, clientApplications] = await Promise.all([
      Notification.countDocuments({ userId, read: false }),
      Notification.find({ userId })
        .select('title message type read createdAt')
        .sort({ createdAt: -1 })
        .limit(3)
        .lean(),
      getClientApplicationStats(userId),
    ]);

    res.json({
      success: true,
      data: {
        notifications: unreadCount,
        latestNotifications,
        applicationsReceived: clientApplications.applicationsReceived,
        unreadApplications: clientApplications.unreadApplications,
        latestApplicants: clientApplications.latestApplicants,
      }
    });
  } catch (error) {
    console.error('Dashboard meta error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get dashboard summary for layout and quick page load
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    if (!isValidMongoId(userId)) {
      res.set('Cache-Control', 'private, no-store');
      return res.json({ success: true, data: buildEmptyDashboardPayload(req.user) });
    }
    const cached = readSummaryCache(userId);
    if (cached) {
      res.set('Cache-Control', 'private, no-store');
      return res.json({ success: true, cached: true, data: cached });
    }

    const [user, wallet, jobsPosted, jobsCompleted, activeJobs, proposals, transactions, notifications, clientApplications] = await Promise.all([
      User.findById(userId).select('firstName lastName email role userType avatar rating').lean(),
      Wallet.findOne({ userId }).select('available escrow').lean(),
      Job.countDocuments({ createdBy: userId }),
      Job.countDocuments({ freelancerId: userId, status: 'completed' }),
      Job.countDocuments({
        $or: [{ createdBy: userId }, { freelancerId: userId }],
        status: { $in: ['open', 'in_progress', 'pending'] }
      }),
      Proposal.countDocuments({ freelancerId: userId }),
      Transaction.find({ userId }).select('type amount description createdAt').sort({ createdAt: -1 }).limit(10).lean(),
      Notification.find({ userId, read: false }).select('title message type createdAt').sort({ createdAt: -1 }).limit(5).lean(),
      getClientApplicationStats(userId),
    ]);

    const totalEarnings = transactions
      .filter((t) => ['RELEASE', 'credit', 'REFERRAL'].includes(t.type))
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const walletBalance = wallet?.available ?? 0;
    const escrowBalance = wallet?.escrow ?? 0;

    const stats = {
      jobsPosted,
      jobsCompleted,
      activeJobs,
      contracts: activeJobs,
      proposals,
      applicationsReceived: clientApplications.applicationsReceived,
      unreadApplications: clientApplications.unreadApplications,
      totalEarnings: toUSD(totalEarnings),
      wallet: walletBalance,
      escrow: escrowBalance,
      rating: user?.rating || 0,
      profileComplete: user ? 70 : 0
    };

    const activities = transactions.slice(0, 5).map(t => ({
      id: t._id,
      type: t.type,
      amount: toUSD(t.amount),
      description: t.description || t.type,
      date: t.createdAt
    }));

    const payload = {
      stats,
      activities,
      latestApplicants: clientApplications.latestApplicants,
      notifications: notifications.map((n) => ({
        id: n._id,
        title: n.title,
        message: n.message,
        type: n.type,
        createdAt: n.createdAt
      })),
      analytics: {},
      wallet: {
        available: walletBalance,
        escrow: escrowBalance
      }
    };

    writeSummaryCache(userId, payload);
    res.set('Cache-Control', 'private, no-store');
    res.json({
      success: true,
      data: payload
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get dashboard overview + analytics in one optimized request
router.get('/full', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    if (!isValidMongoId(userId)) {
      res.set('Cache-Control', 'private, no-store');
      return res.json({ success: true, data: buildEmptyDashboardPayload(req.user) });
    }

    const [
      user,
      wallet,
      jobsPosted,
      jobsCompleted,
      activeJobs,
      proposals,
      transactions,
      notifications,
      earningsByMonth,
      jobStats
    ] = await Promise.all([
      User.findById(userId).select('firstName lastName email role avatar rating').lean(),
      Wallet.findOne({ userId }).select('available escrow totalBalance').lean(),
      Job.countDocuments({ createdBy: userId }),
      Job.countDocuments({ freelancerId: userId, status: 'completed' }),
      Job.countDocuments({
        $or: [{ createdBy: userId }, { freelancerId: userId }],
        status: { $in: ['open', 'in_progress', 'pending'] }
      }),
      Proposal.countDocuments({ freelancerId: userId }),
      Transaction.find({ userId }).select('type amount description createdAt').sort({ createdAt: -1 }).limit(10).lean(),
      Notification.find({ userId, read: false }).select('title message type createdAt').sort({ createdAt: -1 }).limit(5).lean(),
      Transaction.aggregate([
        { $match: { userId, type: 'RELEASE', createdAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } } },
        { $group: { _id: { $month: '$createdAt' }, total: { $sum: '$amount' } } },
        { $sort: { _id: 1 } }
      ]),
      Job.aggregate([
        { $match: { $or: [{ createdBy: userId }, { freelancerId: userId }] } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
    ]);

    const totalEarnings = transactions
      .filter(t => t.type === 'RELEASE' || t.type === 'credit')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const walletBalance = wallet?.available ?? 0;
    const escrowBalance = wallet?.escrow ?? 0;

    const stats = {
      jobsPosted,
      jobsCompleted,
      activeJobs,
      contracts: activeJobs,
      proposals,
      totalEarnings: toUSD(totalEarnings),
      wallet: walletBalance,
      escrow: escrowBalance,
      rating: user?.rating || 0,
      profileComplete: user ? 70 : 0
    };

    const activities = transactions.slice(0, 5).map(t => ({
      id: t._id,
      type: t.type,
      amount: toUSD(t.amount),
      description: t.description || t.type,
      date: t.createdAt
    }));

    const analytics = {
      earningsByMonth: earningsByMonth.map(e => ({ month: e._id, value: e.total * USD_RATE })),
      jobStats: jobStats.reduce((acc, j) => {
        acc[j._id] = j.count;
        return acc;
      }, {}),
      revenueGrowth: (() => {
        const currentMonth = new Date().getMonth() + 1;
        const lastMonthEarnings = earningsByMonth.find(e => e._id === currentMonth)?.total || 0;
        const prevMonthEarnings = earningsByMonth.find(e => e._id === currentMonth - 1)?.total || 0;
        return prevMonthEarnings > 0
          ? Math.round(((lastMonthEarnings - prevMonthEarnings) / prevMonthEarnings) * 100)
          : 0;
      })(),
      totalRevenue: toUSD(earningsByMonth.reduce((sum, e) => sum + (e.total || 0), 0))
    };

    res.json({
      success: true,
      data: {
        stats,
        activities,
        notifications: notifications.map(n => ({
          id: n._id,
          title: n.title,
          message: n.message,
          type: n.type,
          createdAt: n.createdAt
        })),
        analytics,
        user: {
          name: user ? `${user.firstName} ${user.lastName}` : 'User',
          email: user?.email,
          role: user?.role,
          avatar: user?.avatar
        }
      }
    });
  } catch (error) {
    console.error('Dashboard full error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get dashboard analytics
router.get('/analytics', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get earnings over time
    const earningsByMonth = await Transaction.aggregate([
      { $match: { userId, type: 'RELEASE', createdAt: { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } } },
      { 
        $group: { 
          _id: { $month: '$createdAt' }, 
          total: { $sum: '$amount' } 
        } 
      },
      { $sort: { _id: 1 } }
    ]);

    // Get job statistics
    const jobStats = await Job.aggregate([
      { $match: { $or: [{ createdBy: userId }, { freelancerId: userId }] } },
      { 
        $group: { 
          _id: '$status', 
          count: { $sum: 1 } 
        } 
      }
    ]);

    // Calculate growth
    const currentMonth = new Date().getMonth();
    const lastMonthEarnings = earningsByMonth.filter(e => e._id === currentMonth)[0]?.total || 0;
    const prevMonthEarnings = earningsByMonth.filter(e => e._id === currentMonth - 1)[0]?.total || 0;
    const revenueGrowth = prevMonthEarnings > 0 
      ? Math.round(((lastMonthEarnings - prevMonthEarnings) / prevMonthEarnings) * 100) 
      : 0;

    res.json({
      success: true,
      data: {
        earningsByMonth: earningsByMonth.map(e => ({
          month: e._id,
          value: e.total * USD_RATE
        })),
        jobStats: jobStats.reduce((acc, j) => {
          acc[j._id] = j.count;
          return acc;
        }, {}),
        revenueGrowth,
        totalRevenue: toUSD(lastMonthEarnings)
      }
    });
  } catch (error) {
    console.error('Dashboard analytics error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get dashboard stats (legacy endpoint)
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    if (!isValidMongoId(userId)) {
      return res.json({
        success: true,
        data: buildEmptyDashboardPayload(req.user).stats
      });
    }

    const [jobsPosted, jobsCompleted, earnings] = await Promise.all([
      Job.countDocuments({ createdBy: userId }),
      Job.countDocuments({ freelancerId: userId, status: 'completed' }),
      Transaction.aggregate([
        { $match: { userId, type: 'RELEASE' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        jobsPosted,
        jobsCompleted,
        totalEarnings: toUSD(earnings[0]?.total || 0)
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
