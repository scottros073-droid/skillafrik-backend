// backend/routes/adminRoutes.js
const express = require('express');
const router = express.Router();

// ✅ Imports
const isAdmin = require('../middleware/adminMiddleware');
const User = require('../models/User');
const Job = require('../models/Job');
const Payment = require('../models/Payment');
const Withdrawal = require('../models/Withdrawal');
const Settings = require('../models/Settings');
const Transaction = require('../models/Transaction');
const Review = require('../models/Review');
const Escrow = require('../models/Escrow');
const authController = require('../controllers/authController');
const supportController = require('../controllers/supportController');
const adController = require('../controllers/adController');
const notificationService = require('../services/notificationService');

// Apply admin middleware to all routes
router.use(isAdmin);

const refreshRevieweeRating = async (userId) => {
  if (!userId) return;
  const [rating] = await Review.aggregate([
    { $match: { revieweeId: userId, status: 'approved' } },
    { $group: { _id: '$revieweeId', average: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);
  await User.findByIdAndUpdate(userId, {
    rating: rating ? Number(rating.average.toFixed(2)) : 0,
    ratingCount: rating?.count || 0,
    reviewCount: rating?.count || 0
  });
};

// ✅ Admin stats summary (cached at route level)
const statsCache = { data: null, timestamp: null, ttl: 30000 };

router.get('/stats', async (req, res) => {
  try {
    // Return cached stats if available
    if (statsCache.data && (Date.now() - statsCache.timestamp) < statsCache.ttl) {
      return res.json({ ...statsCache.data, cached: true });
    }

    const [totalUsers, activeJobs, escrowTotalAgg, platformBalanceAgg] = await Promise.all([
      User.countDocuments(),
      Job.countDocuments({ status: { $in: ['open', 'in_progress', 'delivered', 'disputed'] } }),
      Escrow.aggregate([
        { $match: { status: { $in: ['PENDING', 'FUNDED', 'DISPUTED'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Payment.aggregate([
        { $match: { status: 'PAID' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    const escrowTotal = escrowTotalAgg[0]?.total || 0;
    const platformBalance = platformBalanceAgg[0]?.total || 0;

    const data = { totalUsers, activeJobs, escrowTotal, platformBalance };
    statsCache.data = data;
    statsCache.timestamp = Date.now();

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error getting stats' });
  }
});

// ✅ Get all payments (Admin) with pagination and optimized queries
router.get('/payments', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100); // Cap at 100 per page
    const skip = (page - 1) * limit;

    // Use lean() for read-only operations, project only needed fields
    const [payments, total] = await Promise.all([
      Payment.find()
        .select('userId gatewayRef amount status purpose createdAt')
        .populate('userId', 'email firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.countDocuments()
    ]);

    res.json({
      success: true,
      data: payments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching payments' });
  }
});

// ✅ Mark payment as refunded
router.post('/payments/:id/refund', async (req, res) => {
  try {
    const payment = await Payment.findByIdAndUpdate(
      req.params.id,
      { status: 'REFUNDED', refundedAt: new Date() },
      { new: true }
    );
    if (!payment) return res.status(404).json({ message: 'Payment not found' });

    res.json({ message: 'Refund marked successfully', payment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error marking refund' });
  }
});

// ✅ List all jobs with pagination and optimized queries
router.get('/jobs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100); // Cap at 100 per page
    const skip = (page - 1) * limit;

    // Use lean() and projections for better performance
    const [jobs, total] = await Promise.all([
      Job.find()
        .select('title status clientId freelancerId budget createdAt')
        .populate('clientId', 'firstName lastName email')
        .populate('freelancerId', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Job.countDocuments()
    ]);

    res.json({
      success: true,
      data: jobs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching jobs' });
  }
});

// ✅ Delete job
router.delete('/jobs/:id', async (req, res) => {
  try {
    const job = await Job.findByIdAndDelete(req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }
    res.json({ success: true, message: 'Job deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error deleting job' });
  }
});

// ✅ Mark job as flagged
router.post('/jobs/:id/flag', async (req, res) => {
  try {
    const job = await Job.findByIdAndUpdate(req.params.id, { flagged: true }, { new: true });
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }
    res.json({ success: true, message: 'Job flagged successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error flagging job' });
  }
});

router.get('/moderation/reviews', async (req, res) => {
  try {
    const reviews = await Review.find({ status: req.query.status || 'pending' })
      .populate('reviewerId', 'firstName lastName email')
      .populate('revieweeId', 'firstName lastName email')
      .populate('jobId', 'title')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ success: true, data: reviews });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error fetching reviews for moderation' });
  }
});

router.post('/moderation/reviews/:id/approve', async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', approvedAt: new Date(), rejectedReason: null },
      { new: true }
    );
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    await refreshRevieweeRating(review.revieweeId);
    res.json({ success: true, data: review });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error approving review' });
  }
});

router.post('/moderation/reviews/:id/reject', async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', rejectedReason: req.body?.reason || 'Rejected by admin' },
      { new: true }
    );
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' });
    await refreshRevieweeRating(review.revieweeId);
    res.json({ success: true, data: review });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error rejecting review' });
  }
});

router.get('/disputes', async (req, res) => {
  try {
    const disputes = await Escrow.find({ $or: [{ status: 'DISPUTED' }, { disputed: true }] })
      .populate('jobId', 'title status')
      .populate('clientId', 'firstName lastName email')
      .populate('freelancerId', 'firstName lastName email')
      .sort({ disputedAt: -1, updatedAt: -1 })
      .limit(100);

    res.json({ success: true, data: disputes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error fetching disputes' });
  }
});

// ✅ Release escrow manually
router.post('/jobs/:id/release', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    const escrow = job?.escrowId ? await Escrow.findById(job.escrowId) : null;
    if (!job || !escrow || escrow.status !== 'FUNDED') {
      return res.status(400).json({ message: 'No escrow to release' });
    }

    const settings = (await Settings.findOne()) || { platformFeePct: 10 };
    const fee = Math.round(escrow.amount * (settings.platformFeePct / 100));
    const workerNet = escrow.amount - fee;

    await User.findByIdAndUpdate(job.freelancerId, { $inc: { totalEarnings: workerNet } });

    escrow.status = 'RELEASED';
    escrow.releasedAt = new Date();
    escrow.releasedBy = req.user.id;
    await escrow.save();
    job.status = 'completed';
    await job.save();

    res.json({ message: 'Escrow released successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error releasing escrow' });
  }
});

// ✅ Get and update platform settings
router.get('/settings', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching settings' });
  }
});

router.post('/settings', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();
    Object.assign(settings, req.body);
    await settings.save();
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error saving settings' });
  }
});

// ✅ List withdrawals
router.get('/withdrawals', async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ status: { $in: ['PENDING', 'COMPLETED'] } })
      .populate('userId', 'firstName lastName email')
      .sort({ createdAt: -1 });

    const formattedWithdrawals = withdrawals.map(w => ({
      user: `${w.userId.firstName} ${w.userId.lastName}`,
      amount: w.amount,
      status: w.status === 'COMPLETED' ? 'approved' : 'pending'
    }));

    res.json(formattedWithdrawals);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching withdrawals' });
  }
});

// ✅ Approve withdrawal
router.post('/withdrawals/:id/approve', async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findByIdAndUpdate(
      req.params.id,
      {
        status: 'COMPLETED',
        approvedBy: req.user.id,
        approvedAt: new Date()
      },
      { new: true }
    );
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }
    res.json({ success: true, message: 'Withdrawal approved successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error approving withdrawal' });
  }
});

// ✅ Reject withdrawal
router.post('/withdrawals/:id/reject', async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findByIdAndUpdate(
      req.params.id,
      {
        status: 'REJECTED',
        rejectedBy: req.user.id,
        rejectedAt: new Date()
      },
      { new: true }
    );
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }
    res.json({ success: true, message: 'Withdrawal rejected successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error rejecting withdrawal' });
  }
});

// ✅ Admin overview endpoint used by frontend dashboard
router.get('/overview', async (req, res) => {
  try {
    // req.user is already set by the global isAdmin middleware which includes authMiddleware
    const totalUsers = await User.countDocuments();
    const totalJobs = await Job.countDocuments();
    const totalPayments = await Payment.countDocuments();
    const totalTransactions = await Transaction.countDocuments();

    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(10).select('firstName lastName email role status country createdAt');
    const recentTransactions = await Transaction.find().sort({ createdAt: -1 }).limit(10).populate('userId', 'firstName lastName');
    const recentJobs = await Job.find().sort({ createdAt: -1 }).limit(10).select('title status price createdAt');

    const responseData = {
      stats: {
        totalUsers,
        totalJobs,
        totalPayments,
        totalTransactions
      },
      users: recentUsers,
      transactions: recentTransactions,
      jobs: recentJobs,
      recentTransactions,
      recentJobs
    };

    res.json(responseData);
  } catch (err) {
    console.error('[BACKEND] Admin overview error:', err);
    res.status(500).json({ success: false, message: 'Error fetching admin overview', error: err.message });
  }
});

// ✅ Admin users list endpoint
router.get('/users', authController.getAllUsers);

// ✅ Suspend user
router.post('/users/:id/suspend', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { status: 'suspended' }, { new: true });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, message: 'User suspended successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error suspending user' });
  }
});

// ✅ Activate user
router.post('/users/:id/activate', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { status: 'active' }, { new: true });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, message: 'User activated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error activating user' });
  }
});

// ✅ Admin support endpoints
router.get('/support', supportController.getAdminOpenTickets);
router.post('/support/reply', supportController.replyToSupportTicket);
router.patch('/support/:id/status', supportController.updateSupportTicketStatus);

// ✅ Admin ads list
router.get('/ads', adController.getAdminAds);

// ✅ Admin transactions list
router.get('/transactions', async (req, res) => {
  try {
    const allPayments = await Payment.find()
      .populate('userId', 'firstName lastName email')
      .sort({ createdAt: -1 });

    const escrowAgg = await Escrow.aggregate([
      { $match: { status: { $in: ['PENDING', 'FUNDED', 'DISPUTED'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const escrowAmounts = escrowAgg[0]?.total || 0;

    const feeAgg = await Transaction.aggregate([
      { $match: { type: 'FEE' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const platformFees = feeAgg[0]?.total || 0;

    const completedPayments = await Payment.countDocuments({ status: 'PAID' });

    res.json({
      allPayments,
      escrowAmounts,
      platformFees,
      completedPayments
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching transactions' });
  }
});

// ✅ Admin dashboard API
router.get('/dashboard', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalFreelancers = await User.countDocuments({ userType: 'freelancer' });
    const totalJobs = await Job.countDocuments();

    const earningsAgg = await Payment.aggregate([
      { $match: { status: 'PAID' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalEarnings = earningsAgg[0]?.total || 0;

    const withdrawalsAgg = await Withdrawal.aggregate([
      { $match: { status: 'COMPLETED' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalWithdrawals = withdrawalsAgg[0]?.total || 0;

    res.json({
      success: true,
      data: {
        totalUsers,
        totalFreelancers,
        totalJobs,
        totalEarnings,
        totalWithdrawals
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching dashboard data' });
  }
});

// ✅ Admin assign freelancer to job
router.post('/jobs/:jobId/assign/:freelancerId', async (req, res) => {
  try {
    const { jobId, freelancerId } = req.params;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (job.status !== 'open') {
      return res.status(400).json({ success: false, message: 'Job is not available for assignment' });
    }

    const freelancer = await User.findById(freelancerId);
    if (!freelancer) {
      return res.status(404).json({ success: false, message: 'Freelancer not found' });
    }

    if (freelancer.userType !== 'freelancer') {
      return res.status(400).json({ success: false, message: 'User is not a freelancer' });
    }

    // Assign freelancer
    job.freelancerId = freelancerId;
    job.status = 'in_progress';
    job.assignedBy = req.user.id; // Admin who assigned
    job.assignedAt = new Date();
    await job.save();

    // Create escrow
    const Escrow = require('../models/Escrow');
    const escrow = await Escrow.create({
      jobId: job._id,
      clientId: job.clientId,
      freelancerId: freelancerId,
      amount: job.budget,
      status: 'PENDING',
      autoReleaseDateAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    job.escrowId = escrow._id;
    await job.save();

    // Send notifications
    await notificationService.notifyJobAssigned(job, freelancer, true);

    res.json({
      success: true,
      message: 'Freelancer assigned to job successfully',
      data: {
        jobId: job._id,
        freelancerId: freelancerId,
        escrowId: escrow._id
      }
    });
  } catch (err) {
    console.error('Error assigning freelancer:', err);
    res.status(500).json({ success: false, message: 'Error assigning freelancer to job' });
  }
});

// ✅ Check notification service status
router.get('/service-status', async (req, res) => {
  try {
    const status = notificationService.getServiceStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (err) {
    console.error('Error getting service status:', err);
    res.status(500).json({ success: false, message: 'Error fetching service status' });
  }
});

module.exports = router;
