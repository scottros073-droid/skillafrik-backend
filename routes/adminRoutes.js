// backend/routes/adminRoutes.js
const express = require('express');
const router = express.Router();

// ✅ Imports
const adminMiddleware = require('../middleware/adminMiddleware');
const User = require('../models/User');
const Job = require('../models/Job');
const Payment = require('../models/Payment');
const Withdrawal = require('../models/Withdrawal');
const Settings = require('../models/Settings');

// ✅ Admin stats summary
router.get('/stats', adminMiddleware, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeJobs = await Job.countDocuments({ status: { $in: ['ACTIVE', 'DELIVERED'] } });

    const escrowTotalAgg = await Job.aggregate([
      { $match: { 'escrow.status': 'HELD' } },
      { $group: { _id: null, total: { $sum: '$escrow.amount' } } }
    ]);
    const escrowTotal = escrowTotalAgg[0]?.total || 0;

    const platformBalanceAgg = await Payment.aggregate([
      { $match: { status: 'PAID' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const platformBalance = platformBalanceAgg[0]?.total || 0;

    res.json({ totalUsers, activeJobs, escrowTotal, platformBalance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error getting stats' });
  }
});

// ✅ Get all payments (Admin)
router.get('/payments', adminMiddleware, async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate('userId', 'email name')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(payments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching payments' });
  }
});

// ✅ Mark payment as refunded
router.post('/payments/:id/refund', adminMiddleware, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ message: 'Payment not found' });

    payment.status = 'REFUNDED';
    await payment.save();
    res.json({ message: 'Refund marked successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error marking refund' });
  }
});

// ✅ List all jobs
router.get('/jobs', adminMiddleware, async (req, res) => {
  try {
    const jobs = await Job.find().sort({ createdAt: -1 }).limit(100);
    res.json(jobs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching jobs' });
  }
});

// ✅ Release escrow manually
router.post('/jobs/:id/release', adminMiddleware, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job || !job.escrow || job.escrow.status !== 'HELD') {
      return res.status(400).json({ message: 'No escrow to release' });
    }

    const settings = (await Settings.findOne()) || { platformFeePct: 10 };
    const fee = Math.round(job.escrow.amount * (settings.platformFeePct / 100));
    const workerNet = job.escrow.amount - fee;

    await User.findByIdAndUpdate(job.workerId, { $inc: { 'wallet.available': workerNet } });

    job.escrow.status = 'RELEASED';
    job.status = 'COMPLETED';
    await job.save();

    res.json({ message: 'Escrow released successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error releasing escrow' });
  }
});

// ✅ Get and update platform settings
router.get('/settings', adminMiddleware, async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching settings' });
  }
});

router.post('/settings', adminMiddleware, async (req, res) => {
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
router.get('/withdrawals', adminMiddleware, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find()
      .populate('userId', 'email name')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(withdrawals);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching withdrawals' });
  }
});

module.exports = router;
