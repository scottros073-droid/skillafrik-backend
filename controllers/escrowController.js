const Escrow = require('../models/Escrow');
const Job = require('../models/Job');
const Proposal = require('../models/Proposal');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const Platform = require('../models/Platform');
const Settings = require('../models/Settings');
const Wallet = require('../models/Wallet');
const monetizationService = require('../services/monetizationService');
const notificationService = require('../services/notificationService');
const { applyHireToJob } = require('../utils/hireWorkflow');
const { resolvePaymentByReference } = require('../utils/paymentResolver');
const { ESCROW_STATE_LABELS, emitEscrowFunded, emitEscrowReleased } = require('../utils/escrowEvents');
const { enrichJobWithWorkStatus } = require('../utils/workStatus');

const getEscrowWorkflowStatus = (escrow, job = null) => {
  if (!escrow) return ESCROW_STATE_LABELS.PENDING;
  if (escrow.status === 'DISPUTED') return ESCROW_STATE_LABELS.DISPUTED;
  if (escrow.status === 'RELEASED') return ESCROW_STATE_LABELS.RELEASED;
  if (escrow.status === 'REFUNDED') return ESCROW_STATE_LABELS.REFUNDED;
  if (escrow.status === 'PENDING') return ESCROW_STATE_LABELS.PENDING;
  if (job?.status === 'delivered') return 'Work Submitted';
  if (job?.status === 'completed') return ESCROW_STATE_LABELS.RELEASED;
  if (escrow.status === 'FUNDED') return ESCROW_STATE_LABELS.FUNDED;
  return ESCROW_STATE_LABELS[escrow.status] || escrow.status;
};

const getCommissionSplit = async (amount, session = null) => {
  const settingsQuery = Settings.findOne();
  const settings = session ? await settingsQuery.session(session) : await settingsQuery;
  const platformFeePct = Number(settings?.platformFeePct ?? 10);
  const commissionAmount = Math.round(Number(amount || 0) * (platformFeePct / 100));
  return {
    platformFeePct,
    commissionAmount,
    freelancerAmount: Number(amount || 0) - commissionAmount
  };
};

// Create escrow when job is accepted
const createEscrow = async (req, res) => {
  try {
    const { jobId, freelancerId } = req.body;
    const clientId = req.user.id;

    const job = await Job.findById(jobId);
    if (!job || job.clientId.toString() !== clientId) {
      return res.status(404).json({ success: false, message: 'Job not found or unauthorized' });
    }

    if (job.status !== 'open') {
      return res.status(400).json({ success: false, message: 'Job is not available for hiring' });
    }

    // Validate freelancer selection
    if (!freelancerId) {
      return res.status(400).json({ success: false, message: 'Freelancer ID is required' });
    }

    if (freelancerId.toString() === clientId.toString()) {
      return res.status(400).json({ success: false, message: 'Client cannot be assigned as freelancer for the same job' });
    }

    const freelancer = await User.findById(freelancerId);
    if (!freelancer) {
      return res.status(404).json({ success: false, message: 'Freelancer not found' });
    }

    if (freelancer.userType !== 'freelancer') {
      return res.status(400).json({ success: false, message: 'Selected user is not a freelancer' });
    }

    // Check if escrow already exists
    const existingEscrow = await Escrow.findOne({ jobId });
    if (existingEscrow) {
      return res.status(400).json({ success: false, message: 'Escrow already exists for this job' });
    }

    // Create escrow
    const escrow = await Escrow.create({
      jobId,
      clientId,
      freelancerId,
      amount: job.budget,
      autoReleaseDateAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    });

    applyHireToJob(job, freelancerId, clientId);
    job.escrowId = escrow._id;
    job.escrowStatus = 'pending';
    job.escrowAmount = job.budget;
    job.escrowAutoReleaseDate = escrow.autoReleaseDateAt;
    await job.save();
    await Proposal.updateMany(
      { jobId, freelancerId },
      { status: 'accepted', acceptedAt: new Date() }
    );
    const notSelectedProposals = await Proposal.find({ jobId, freelancerId: { $ne: freelancerId } }).select('freelancerId');
    await Proposal.updateMany(
      { jobId, freelancerId: { $ne: freelancerId } },
      { status: 'rejected', rejectedAt: new Date(), rejectionReason: 'Not selected' }
    );

    try {
      const freelancer = await User.findById(freelancerId);
      if (freelancer) {
        await notificationService.notifyJobAssigned(job, freelancer, false);
        await notificationService.notifyClientFreelancerHired(job, freelancer);
        await Promise.all(notSelectedProposals.map((proposal) => (
          notificationService.notifyApplicantNotSelected(job, proposal.freelancerId)
        )));
      }
    } catch (notificationError) {
      console.error('Escrow hire notifications failed:', notificationError);
    }

    res.status(201).json({
      success: true,
      data: {
        message: 'Escrow created successfully',
        escrowId: escrow._id,
        autoReleaseDate: escrow.autoReleaseDateAt
      }
    });
  } catch (error) {
    console.error('Error creating escrow:', error);
    res.status(500).json({ success: false, message: 'Failed to create escrow' });
  }
};

const fundEscrowInternal = async ({ escrowId, paymentReference, payerId, app }) => {
  const escrow = await Escrow.findById(escrowId);
  if (!escrow) {
    throw new Error('Escrow not found');
  }

  const resolvedReference = paymentReference || null;
  const payment = resolvedReference
    ? await resolvePaymentByReference(resolvedReference, 'job_escrow')
    : null;

  if (escrow.status === 'FUNDED') {
    if (resolvedReference && escrow.paymentReference === resolvedReference) {
      return { escrow, alreadyFunded: true };
    }
    if (!resolvedReference || escrow.paymentReference) {
      return { escrow, alreadyFunded: true };
    }
  }

  if (escrow.status !== 'PENDING') {
    throw new Error('Escrow is not in pending status');
  }

  if (!payment) {
    throw new Error('Associated payment record not found');
  }

  const paymentRef = payment.gatewayRef || payment._id.toString();

  if (payment.userId.toString() !== escrow.clientId.toString()) {
    throw new Error('Only the escrow client may fund this escrow');
  }

  if (payment.status !== 'PAID') {
    throw new Error('Payment must be completed through Paystack before funding escrow');
  }

  if ((payment.metadata?.escrowId || '').toString() !== escrowId.toString()) {
    throw new Error('Payment does not belong to this escrow');
  }

  if (escrow.clientId.toString() === escrow.freelancerId.toString()) {
    throw new Error('Invalid escrow setup: payer and receiver must be different');
  }

  const existingLedger = await Transaction.findOne({
    escrowId,
    paymentReference: paymentRef,
    type: 'ESCROW',
  });
  if (existingLedger) {
    const syncedEscrow = await Escrow.findById(escrowId);
    return { escrow: syncedEscrow, alreadyFunded: true };
  }

  const session = await Escrow.startSession();
  session.startTransaction();

  try {
    const fundedEscrow = await Escrow.findOneAndUpdate(
      { _id: escrowId, status: 'PENDING' },
      {
        $set: {
          status: 'FUNDED',
          paymentReference: paymentRef,
          paymentVerified: true,
          fundedAt: new Date(),
        },
      },
      { new: true, session }
    );

    if (!fundedEscrow) {
      const current = await Escrow.findById(escrowId).session(session);
      if (current?.status === 'FUNDED') {
        await session.abortTransaction();
        return { escrow: current, alreadyFunded: true };
      }
      throw new Error('Escrow was already funded or changed status');
    }

    await Transaction.create(
      [{
        userId: escrow.clientId,
        type: 'ESCROW',
        amount: escrow.amount,
        description: `Escrow funding for job ${escrow.jobId}`,
        escrowId,
        jobId: escrow.jobId,
        paymentReference: paymentRef,
        metadata: { escrowId, jobId: escrow.jobId, paymentId: payment._id },
      }],
      { session }
    );

    await Wallet.findOneAndUpdate(
      { userId: escrow.freelancerId },
      { $inc: { escrow: escrow.amount } },
      { upsert: true, setDefaultsOnInsert: true, session }
    );

    const job = await Job.findByIdAndUpdate(
      escrow.jobId,
      {
        $set: {
          escrowStatus: 'funded',
          escrowAmount: escrow.amount,
          escrowFundedDate: new Date(),
        },
      },
      { new: true, session }
    );

    await session.commitTransaction();

    await notificationService.notifyEscrowSecured(fundedEscrow, job).catch((err) => {
      console.error('Escrow secured notification failed:', err);
    });

    const io = app?.get?.('io');
    if (io) {
      await emitEscrowFunded(io, fundedEscrow, job);
    }

    return { escrow: fundedEscrow, alreadyFunded: false };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Fund escrow (called after payment verification)
const fundEscrow = async (req, res) => {
  try {
    const { escrowId, paymentReference } = req.body;

    const result = await fundEscrowInternal({
      escrowId,
      paymentReference,
      payerId: req.user.id,
      app: req.app,
    });

    const { escrow: fundedEscrow, alreadyFunded } = result;
    const freelancerWallet = await Wallet.findOne({ userId: fundedEscrow.freelancerId });

    res.json({
      success: true,
      data: {
        message: alreadyFunded ? 'Escrow is already funded' : 'Escrow funded successfully',
        escrowId: fundedEscrow._id,
        status: fundedEscrow.status,
        statusLabel: ESCROW_STATE_LABELS[fundedEscrow.status] || fundedEscrow.status,
        alreadyFunded: Boolean(alreadyFunded),
        wallet: freelancerWallet ? {
          available: freelancerWallet.available,
          escrow: freelancerWallet.escrow,
          totalBalance: freelancerWallet.totalBalance,
        } : null,
      },
    });
  } catch (error) {
    console.error('Error funding escrow:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fund escrow' });
  }
};

// Release escrow (client approval or auto-release)
const releaseEscrow = async (req, res) => {
  const session = await Escrow.startSession();
  session.startTransaction();

  try {
    const { escrowId } = req.params;
    const { notes } = req.body;
    const releasedBy = req.user.id;

    const escrow = await Escrow.findById(escrowId).populate('jobId').session(session);
    if (!escrow) {
      throw new Error('Escrow not found');
    }

    if (escrow.status !== 'FUNDED') {
      throw new Error('Escrow is not funded');
    }

    // Check authorization (client or admin)
    const user = await User.findById(releasedBy).session(session);
    const isClient = escrow.clientId.toString() === releasedBy;
    const isAdmin = user && user.userType === 'admin';

    if (!isClient && !isAdmin) {
      throw new Error('Unauthorized to release escrow');
    }

    if (escrow.freelancerId.toString() === releasedBy) {
      throw new Error('Freelancer cannot approve release for their own escrow');
    }

    if (escrow.clientId.toString() === escrow.freelancerId.toString()) {
      throw new Error('Invalid escrow setup: client and freelancer must be distinct');
    }

    const job = escrow.jobId;
    if (!isAdmin && job?.status !== 'delivered') {
      throw new Error('Work must be submitted before escrow can be released');
    }

    const { platformFeePct, commissionAmount, freelancerAmount } = await getCommissionSplit(escrow.amount, session);

    if (freelancerAmount <= 0) {
      throw new Error('Escrow amount is too small to release after commission');
    }

    // Update escrow atomically
    const claimedEscrow = await Escrow.findOneAndUpdate(
      { _id: escrowId, status: 'FUNDED' },
      {
        $set: {
          status: 'RELEASED',
          releasedAt: new Date(),
          releasedBy,
          releaseNotes: notes
        }
      },
      { new: true, session }
    );

    if (!claimedEscrow) {
      throw new Error('Escrow was already released or changed status');
    }

    // Update freelancer wallet atomically
    await Wallet.findOneAndUpdate(
      { userId: escrow.freelancerId },
      { $inc: { available: freelancerAmount, escrow: -escrow.amount, totalBalance: -commissionAmount } },
      { upsert: true, setDefaultsOnInsert: true, session }
    );

    // Update platform balance atomically
    await Platform.updateOne(
      {},
      { $inc: { balance: commissionAmount } },
      { upsert: true, session }
    );

    // Create transaction records atomically
    await Transaction.create(
      [
        {
          type: 'FEE',
          userId: escrow.clientId,
          amount: commissionAmount,
          jobId: escrow.jobId._id || escrow.jobId,
          note: 'Platform commission from escrow',
          description: 'Platform commission from escrow',
          escrowId: escrow._id
        },
        {
          type: 'RELEASE',
          userId: escrow.freelancerId,
          amount: freelancerAmount,
          jobId: escrow.jobId._id || escrow.jobId,
          note: 'Escrow released',
          description: 'Escrow released to wallet',
          escrowId: escrow._id
        }
      ],
      { session }
    );

    const jobId = escrow.jobId._id || escrow.jobId;
    const approvedAt = new Date();
    const updatedJob = await Job.findByIdAndUpdate(
      jobId,
      {
        $set: {
          status: 'completed',
          approvedAt,
          completedAt: approvedAt,
          escrowStatus: 'released',
          escrowReleaseDate: approvedAt,
        },
      },
      { new: true, session }
    );

    await session.commitTransaction();

    const io = req.app?.get?.('io');
    if (io) {
      await emitEscrowReleased(io, claimedEscrow, updatedJob, freelancerAmount);
    }

    notificationService
      .notifyPaymentReleased(updatedJob || escrow.jobId, escrow.freelancerId, freelancerAmount)
      .catch((notificationError) => {
        console.error('Escrow release notification failed:', notificationError);
      });

    const freelancerWallet = await Wallet.findOne({ userId: escrow.freelancerId });

    res.json({
      success: true,
      message: 'Payment approved and released to freelancer wallet',
      data: {
        freelancerAmount,
        commissionAmount,
        platformFeePct,
        escrowId: claimedEscrow._id,
        job: enrichJobWithWorkStatus(updatedJob),
        wallet: freelancerWallet ? {
          available: freelancerWallet.available,
          escrow: freelancerWallet.escrow,
          totalBalance: freelancerWallet.totalBalance,
        } : null,
      },
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Error releasing escrow:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to release escrow' });
  } finally {
    await session.endSession();
  }
};

// Auto-release escrow (cron job)
const autoReleaseEscrow = async (escrowId) => {
  try {
    const escrow = await Escrow.findById(escrowId);
    if (!escrow || escrow.status !== 'FUNDED') {
      return;
    }

    if (new Date() < escrow.autoReleaseDateAt) {
      return; // Not yet time to auto-release
    }

    const { commissionAmount, freelancerAmount } = await getCommissionSplit(escrow.amount);

    if (freelancerAmount > 0) {
      await Wallet.findOneAndUpdate(
        { userId: escrow.freelancerId },
        { $inc: { available: freelancerAmount, escrow: -escrow.amount, totalBalance: -commissionAmount } },
        { upsert: true, setDefaultsOnInsert: true }
      );
      await Platform.updateOne({}, { $inc: { balance: commissionAmount } }, { upsert: true });

      await Transaction.create({
        type: 'FEE',
        userId: escrow.clientId,
        amount: commissionAmount,
        jobId: escrow.jobId,
        note: 'Platform commission from auto-release escrow',
        description: 'Platform commission from auto-release escrow',
        escrowId: escrow._id
      });

      await Transaction.create({
        type: 'RELEASE',
        userId: escrow.freelancerId,
        amount: freelancerAmount,
        jobId: escrow.jobId,
        note: 'Auto-release escrow payout to freelancer',
        description: 'Auto-release escrow payout to freelancer',
        escrowId: escrow._id
      });
    }

    escrow.status = 'RELEASED';
    escrow.releasedAt = new Date();
    escrow.releaseNotes = 'Auto-released after 7 days';
    await escrow.save();

    const job = await Job.findById(escrow.jobId);
    if (job) {
      job.status = 'completed';
      job.completedAt = new Date();
      job.escrowStatus = 'released';
      job.escrowReleaseDate = new Date();
      await job.save();
    }

  } catch (error) {
    console.error('Error auto-releasing escrow:', error);
  }
};

// Refund escrow (dispute resolution)
const refundEscrow = async (req, res) => {
  try {
    const { escrowId } = req.params;
    const { reason } = req.body;
    const refundedBy = req.user.id;

    const escrow = await Escrow.findById(escrowId);
    if (!escrow) {
      return res.status(404).json({ success: false, message: 'Escrow not found' });
    }

    if (escrow.status !== 'FUNDED') {
      return res.status(400).json({ success: false, message: 'Escrow is not funded' });
    }

    // Check if admin
    const user = await User.findById(refundedBy);
    if (!user || user.userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can refund escrow' });
    }

    // Refund to client
    await monetizationService.updateWalletBalance(
      escrow.clientId,
      escrow.amount,
      'credit',
      `Escrow refund for job ${escrow.jobId}`
    );

    await Wallet.findOneAndUpdate(
      { userId: escrow.freelancerId },
      { $inc: { escrow: -escrow.amount, totalBalance: -escrow.amount } },
      { upsert: true, setDefaultsOnInsert: true }
    );

    // Update escrow
    escrow.status = 'REFUNDED';
    escrow.refundedAt = new Date();
    escrow.releaseNotes = `Refunded by admin: ${reason}`;
    escrow.releasedBy = refundedBy;
    await escrow.save();

    // Update job status
    const job = await Job.findById(escrow.jobId);
    job.status = 'cancelled';
    job.escrowStatus = 'refunded';
    await job.save();

    return res.json({
      success: true,
      data: {
        message: 'Escrow refunded successfully',
        amount: escrow.amount
      }
    });
  } catch (error) {
    console.error('Error refunding escrow:', error);
    res.status(500).json({ success: false, message: 'Failed to refund escrow' });
  }
};

const disputeEscrow = async (req, res) => {
  try {
    const { escrowId } = req.params;
    const { reason = 'Dispute opened from SkillAfrik dashboard' } = req.body || {};
    const userId = req.user.id;

    const escrow = await Escrow.findById(escrowId);
    if (!escrow) {
      return res.status(404).json({ success: false, message: 'Escrow not found' });
    }

    const isParticipant = [escrow.clientId.toString(), escrow.freelancerId.toString()].includes(userId);
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Only job participants can dispute this escrow' });
    }

    if (!['PENDING', 'FUNDED'].includes(escrow.status)) {
      return res.status(400).json({ success: false, message: 'This escrow cannot be disputed at its current stage' });
    }

    escrow.status = 'DISPUTED';
    escrow.disputed = true;
    escrow.disputeReason = String(reason).slice(0, 500);
    escrow.disputedAt = new Date();
    await escrow.save();

    await Job.findByIdAndUpdate(escrow.jobId, { $set: { status: 'disputed', escrowStatus: 'disputed' } });

    res.json({
      success: true,
      message: 'Dispute opened. An admin will review this escrow.',
      data: { escrowId: escrow._id, status: escrow.status }
    });
  } catch (error) {
    console.error('Error disputing escrow:', error);
    res.status(500).json({ success: false, message: 'Failed to open dispute' });
  }
};

// Get escrow details
const getEscrow = async (req, res) => {
  try {
    const { escrowId } = req.params;
    const userId = req.user.id;

    const escrow = await Escrow.findById(escrowId)
      .populate('jobId', 'title budget')
      .populate('clientId', 'firstName lastName')
      .populate('freelancerId', 'firstName lastName');

    if (!escrow) {
      return res.status(404).json({ success: false, message: 'Escrow not found' });
    }

    // Check authorization
    const isClient = escrow.clientId._id.toString() === userId;
    const isFreelancer = escrow.freelancerId._id.toString() === userId;
    const user = await User.findById(userId);
    const isAdmin = user && user.userType === 'admin';

    if (!isClient && !isFreelancer && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized to view escrow' });
    }

    res.json({
      success: true,
      data: {
        escrow: {
          id: escrow._id,
          jobId: escrow.jobId._id,
          jobTitle: escrow.jobId.title,
          amount: escrow.amount,
          status: escrow.status,
          statusLabel: getEscrowWorkflowStatus(escrow, escrow.jobId),
          fundedAt: escrow.fundedAt,
          autoReleaseDate: escrow.autoReleaseDateAt,
          releasedAt: escrow.releasedAt,
          client: {
            id: escrow.clientId._id,
            name: `${escrow.clientId.firstName} ${escrow.clientId.lastName}`
          },
          freelancer: {
            id: escrow.freelancerId._id,
            name: `${escrow.freelancerId.firstName} ${escrow.freelancerId.lastName}`
          }
        }
      }
    });
  } catch (error) {
    console.error('Error getting escrow:', error);
    res.status(500).json({ success: false, message: 'Failed to get escrow' });
  }
};

// Get escrows for user
const getUserEscrows = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    const query = {
      $or: [{ clientId: userId }, { freelancerId: userId }]
    };

    if (status) {
      query.status = status;
    }

    const escrows = await Escrow.find(query)
      .populate('jobId', 'title budget status')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: escrows.map(escrow => ({
        id: escrow._id,
        jobId: escrow.jobId._id,
        jobTitle: escrow.jobId.title,
        amount: escrow.amount,
        status: escrow.status,
        statusLabel: getEscrowWorkflowStatus(escrow, escrow.jobId),
        createdAt: escrow.createdAt,
        autoReleaseDate: escrow.autoReleaseDateAt
      }))
    });
  } catch (error) {
    console.error('Error getting user escrows:', error);
    res.status(500).json({ success: false, message: 'Failed to get escrows' });
  }
};

module.exports = {
  createEscrow,
  fundEscrow,
  fundEscrowInternal,
  releaseEscrow,
  refundEscrow,
  disputeEscrow,
  getEscrow,
  getUserEscrows,
  autoReleaseEscrow
};
