const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Job = require('../models/Job');
const Payment = require('../models/Payment');

// ==============================
// POST /api/jobs - Post a new job
// ==============================
router.post('/', auth, async (req, res) => {
  try {
    const { title, description, amount, currency, deadline, workerId } = req.body;
    const user = await User.findById(req.user.id);

    if (!['worker', 'company', 'client'].includes(user.role)) {
      return res.status(403).json({ message: 'You are not allowed to post jobs' });
    }

    const jobData = { title, description, amount, currency, deadline, status: 'OPEN' };

    if (user.role === 'worker') {
      jobData.workerId = user._id;
    } else if (user.role === 'company' || user.role === 'client') {
      jobData.clientId = user._id;
      if (workerId) {
        const worker = await User.findById(workerId);
        if (!worker || worker.role !== 'worker') {
          return res.status(400).json({ message: 'Invalid workerId provided' });
        }
        jobData.workerId = worker._id;
      }
    }

    const job = await Job.create(jobData);
    res.status(201).json({ message: 'Job posted successfully', job });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error posting job', error: err.message });
  }
});

// ==============================
// GET /api/jobs - List all jobs
// ==============================
router.get('/', async (req, res) => {
  try {
    const jobs = await Job.find().populate('workerId clientId companyId', 'name email role');
    res.json(jobs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching jobs', error: err.message });
  }
});

// ==============================
// POST /api/jobs/:jobId/hire - Client pays escrow
// ==============================
router.post('/:jobId/hire', auth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (!job.workerId) return res.status(400).json({ message: 'No worker assigned for this job' });

    if (job.clientId?.toString() !== userId && job.companyId?.toString() !== userId) {
      return res.status(403).json({ message: 'Not authorized to pay escrow for this job' });
    }

    const payment = await Payment.create({
      jobId,
      userId,
      amount: job.amount,
      currency: job.currency || 'NGN',
      purpose: 'job_escrow',
      status: 'PENDING',
      gateway: 'paystack',
      gatewayRef: `PSK_${Date.now()}`
    });

    res.json({
      message: 'Payment created for hiring worker',
      paymentId: payment._id,
      gateway: payment.gateway,
      gatewayRef: payment.gatewayRef,
      amount: payment.amount,
      currency: payment.currency,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error creating payment', error: err.message });
  }
});

// ==============================
// POST /api/jobs/:jobId/deliver - Worker delivers job
// ==============================
router.post('/:jobId/deliver', auth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { files, message } = req.body;
    const userId = req.user.id;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (job.workerId?.toString() !== userId)
      return res.status(403).json({ message: 'Not authorized to deliver this job' });

    job.status = 'DELIVERED';
    job.delivery = { files: files || [], message: message || '', deliveredAt: new Date() };

    const payment = await Payment.findOne({ jobId, purpose: 'job_escrow', status: 'PAID' });
    if (payment) job.escrow = { status: 'HELD' };

    await job.save();
    res.json({ message: 'Job delivered successfully', job });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ==============================
// POST /api/jobs/:jobId/approve - Client approves delivery
// ==============================
router.post('/:jobId/approve', auth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const clientId = req.user._id;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    if (String(job.clientId) !== String(clientId)) {
      return res.status(403).json({ message: 'Only the client can approve this job' });
    }

    if (!job.escrowPaid || job.escrow?.status !== 'HELD') {
      return res.status(400).json({ message: 'Escrow not held for this job' });
    }

    // Release escrow split: 10% platform, 90% worker
    const platformFee = job.amount * 0.10;
    const workerAmount = job.amount * 0.90;

    job.status = 'COMPLETED';
    job.escrow.status = 'RELEASED';
    job.platformEarnings = platformFee;
    job.workerEarnings = workerAmount;

    await job.save();

    res.json({
      message: 'Delivery approved and escrow released',
      job,
      payout: { platform: platformFee, worker: workerAmount },
    });

  } catch (err) {
    console.error('Approve Error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ==============================
// POST /api/jobs/:jobId/review - Client reviews job
// ==============================
router.post('/:jobId/review', auth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user.id;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (job.status !== 'DELIVERED') return res.status(400).json({ message: 'Job not delivered yet' });
    if (job.clientId?.toString() !== userId && job.companyId?.toString() !== userId)
      return res.status(403).json({ message: 'Not authorized to review this job' });

    job.reviews.push({ reviewerId: userId, rating, comment });
    await job.save();

    // Update worker average rating
    const worker = await User.findById(job.workerId);
    const allJobs = await Job.find({ workerId: worker._id, 'reviews.rating': { $exists: true } });
    const avgRating =
      allJobs.reduce((sum, j) => {
        const ratings = j.reviews.map(r => r.rating);
        return sum + (ratings.length ? ratings.reduce((a, b) => a + b) / ratings.length : 0);
      }, 0) / allJobs.length;
    worker.rating = avgRating || 0;
    await worker.save();

    res.json({ message: 'Review submitted successfully', job });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error submitting review', error: err.message });
  }
});

module.exports = router;
