// backend/routes/escrowRoutes.js
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const router = express.Router();
const { authMiddleware, adminMiddleware, requireRole } = require('../middleware/authMiddleware');
const escrowController = require('../controllers/escrowController');
const Payments = require('../models/Payment');
const Jobs = require('../models/Job');
const Escrow = require('../models/Escrow');
const Transactions = require('../models/Transaction');
const Settings = require('../models/Settings');
const Users = require('../models/User');
const Platform = require('../models/Platform');
const Withdrawals = require('../models/Withdrawal');
const Wallet = require('../models/Wallet');

// Optional gateway placeholder to prevent runtime errors when a gateway service is not configured.
const gateway = {
  transfer: async () => ({ status: 'failed', reference: null }),
};

const rawBodyParser = bodyParser.raw({ type: 'application/json' });

const authWorker = (req, res, next) => {
  if (req.user && req.user.userType === 'freelancer') return next();
  return res.status(401).json({ message: 'Unauthorized' });
};

function verifyGatewaySignature(req) {
  const signature = req.headers['x-paystack-signature'];
  const computed = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex');
  return signature === computed;
}

// Create escrow (when job is accepted)
router.post('/create', authMiddleware, escrowController.createEscrow);

// Fund escrow (after payment)
router.post('/fund', authMiddleware, escrowController.fundEscrow);

// Release escrow (client approval)
router.post('/:escrowId/release', authMiddleware, escrowController.releaseEscrow);

// Refund escrow (admin only)
router.post('/:escrowId/refund', authMiddleware, adminMiddleware, escrowController.refundEscrow);

// Dispute escrow (client or freelancer)
router.post('/:escrowId/dispute', authMiddleware, escrowController.disputeEscrow);

// Get escrow details
router.get('/:escrowId', authMiddleware, escrowController.getEscrow);

// Get user's escrows
router.get('/', authMiddleware, escrowController.getUserEscrows);

// Webhook handling (hold in escrow)
router.post('/webhooks/payments', rawBodyParser, async (req, res) => {
  try {
    if (!verifyGatewaySignature(req)) return res.status(400).send('invalid');

    const event = JSON.parse(req.body.toString());
    if (event.type === 'charge.success') {
      const payment = await Payments.findOne({ gatewayRef: event.data.reference });
      if (!payment || payment.status === 'PAID') return res.status(200).send('ok');

      payment.status = 'PAID';
      payment.paidAt = new Date();
      await payment.save();

      if (payment.metadata.purpose === 'job_escrow') {
        await Jobs.updateOne(
          { _id: payment.jobId },
          { $set: { 'escrow.amount': payment.amount, 'escrow.status': 'HELD' } }
        );

        await Transactions.create({
          type: 'ESCROW',
          userId: payment.metadata.userId,
          jobId: payment.jobId,
          amount: payment.amount,
          note: 'Funds held in escrow',
          description: 'Funds held in escrow',
          paymentReference: payment.gatewayRef
        });
      }

      return res.status(200).send('ok');
    }

    res.status(200).send('ignored');
  } catch (err) {
    console.error('🔥 Webhook error:', err);
    res.status(500).send('error');
  }
});

// Escrow release (after approval)
router.post('/jobs/:id/approve', authMiddleware, async (req, res) => {
  try {
    const job = await Jobs.findById(req.params.id);
    if (!job) return res.status(404).send('Job not found');

    const escrow = job.escrowId ? await Escrow.findById(job.escrowId) : null;
    if (!escrow || escrow.status !== 'FUNDED') {
      return res.status(400).send('No funds held in escrow');
    }

    const workerId = job.workerId || job.freelancerId || escrow.freelancerId;
    const userId = req.user.id;
    const isClient = job.clientId && job.clientId.toString() === userId;
    const isWorker = workerId && workerId.toString() === userId;
    const isAdmin = req.user.userType === 'admin' || req.user.role === 'admin';

    if (isWorker) {
      return res.status(403).send('Freelancers cannot approve their own jobs');
    }

    if (!isClient && !isAdmin) {
      return res.status(403).send('Unauthorized to approve this job');
    }

    if (job.clientId && workerId && job.clientId.toString() === workerId.toString()) {
      return res.status(400).send('Invalid job configuration: client and freelancer must be different');
    }

    const settings = (await Settings.findOne()) || { platformFeePct: 10 };
    const feePct = settings.platformFeePct / 100;
    const fee = Math.round(escrow.amount * feePct);
    const workerNet = escrow.amount - fee;

    if (workerNet <= 0) {
      return res.status(400).send('Escrow amount is too small to release after commission');
    }

    const claimedEscrow = await Escrow.findOneAndUpdate(
      { _id: escrow._id, status: 'FUNDED' },
      { $set: { status: 'RELEASED', releasedAt: new Date() } },
      { new: true }
    );

    if (!claimedEscrow) {
      return res.status(409).send('Escrow was already released or changed status');
    }

    await Wallet.findOneAndUpdate(
      { userId: workerId },
      { $inc: { available: workerNet, totalBalance: workerNet } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    await Platform.updateOne({}, { $inc: { balance: fee } }, { upsert: true });

    await Transactions.create({
      type: 'FEE',
      amount: fee,
      userId: job.clientId,
      jobId: job._id,
      note: 'Platform commission from escrow release',
      description: 'Platform commission from escrow release',
      escrowId: escrow._id
    });
    await Transactions.create({
      type: 'RELEASE',
      userId: workerId,
      amount: workerNet,
      jobId: job._id,
      note: 'Released from escrow to freelancer',
      description: 'Released from escrow to freelancer',
      escrowId: escrow._id
    });

    job.status = 'completed';
    await job.save();

    res.json({ ok: true });
  } catch (err) {
    console.error('🔥 Escrow release error:', err);
    res.status(500).json({ message: 'Error releasing escrow' });
  }
});

// Worker withdrawal
router.post('/wallets/withdraw', authWorker, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await Users.findById(req.user.id);
    if (!user) return res.status(404).send('User not found');

    const wallet = await Wallet.findOne({ userId: user._id });
    if (!wallet || wallet.available < amount) return res.status(400).send('Insufficient funds');

    const settings = (await Settings.findOne()) || { withdrawalFee: 50 };
    await Wallet.updateOne(
      { userId: user._id },
      { $inc: { available: -amount, frozen: amount } }
    );

    const withdrawal = await Withdrawals.create({ userId: user._id, amount, status: 'PENDING' });
    const transfer = await gateway.transfer({
      amount: amount - settings.withdrawalFee,
      recipient: user.paymentAccount,
    });

    if (transfer.status === 'success') {
      withdrawal.status = 'COMPLETED';
      withdrawal.gatewayRef = transfer.reference;
      await Wallet.updateOne(
        { userId: user._id },
        { $inc: { frozen: -amount, totalWithdrawnAmount: amount, totalBalance: -amount } }
      );
    } else {
      withdrawal.status = 'FAILED';
      await Wallet.updateOne(
        { userId: user._id },
        { $inc: { available: amount, frozen: -amount } }
      );
    }

    await withdrawal.save();
    res.json({ ok: true, withdrawal });
  } catch (err) {
    console.error('🔥 Withdrawal error:', err);
    res.status(500).json({ message: 'Withdrawal failed' });
  }
});

module.exports = router;
