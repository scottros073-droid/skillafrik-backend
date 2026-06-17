const Wallet = require('../models/Wallet');
const Job = require('../models/Job');

const ESCROW_STATE_LABELS = {
  PENDING: 'Pending',
  FUNDED: 'Payment Secured',
  RELEASED: 'Released',
  REFUNDED: 'Refunded',
  DISPUTED: 'Disputed',
};

const buildWalletPayload = (wallet) => ({
  balance: Number(wallet?.available ?? 0),
  escrow: Number(wallet?.escrow ?? 0),
  available: Number(wallet?.available ?? 0),
  totalBalance: Number(wallet?.totalBalance ?? 0),
});

const emitEscrowFunded = async (io, escrow, job = null) => {
  if (!io || !escrow) return;

  const resolvedJob = job || await Job.findById(escrow.jobId).select('title escrowStatus status');
  const [freelancerWallet, clientWallet] = await Promise.all([
    Wallet.findOne({ userId: escrow.freelancerId }),
    Wallet.findOne({ userId: escrow.clientId }),
  ]);

  const eventPayload = {
    escrowId: escrow._id,
    jobId: escrow.jobId,
    jobTitle: resolvedJob?.title,
    amount: escrow.amount,
    status: escrow.status,
    statusLabel: ESCROW_STATE_LABELS.FUNDED,
    escrowStatus: 'funded',
    fundedAt: escrow.fundedAt,
  };

  const freelancerPayload = buildWalletPayload(freelancerWallet);
  const clientPayload = buildWalletPayload(clientWallet);

  io.to(`user:${escrow.freelancerId}`).emit('escrow_funded', eventPayload);
  io.to(`user:${escrow.freelancerId}`).emit('wallet_updated', freelancerPayload);
  io.to(`user:${escrow.freelancerId}`).emit('payment_success', {
    ...freelancerPayload,
    transaction: { type: 'escrow_secured', amount: escrow.amount, jobId: escrow.jobId },
  });

  io.to(`user:${escrow.clientId}`).emit('escrow_funded', eventPayload);
  io.to(`user:${escrow.clientId}`).emit('wallet_updated', clientPayload);
};

const emitEscrowReleased = async (io, escrow, job, freelancerAmount) => {
  if (!io || !escrow) return;

  const resolvedJob = job || await Job.findById(escrow.jobId).select('title status escrowStatus workStatus');
  const freelancerWallet = await Wallet.findOne({ userId: escrow.freelancerId });
  const clientWallet = await Wallet.findOne({ userId: escrow.clientId });
  const freelancerPayload = buildWalletPayload(freelancerWallet);

  const eventPayload = {
    escrowId: escrow._id,
    jobId: escrow.jobId?._id || escrow.jobId,
    jobTitle: resolvedJob?.title,
    amount: freelancerAmount ?? escrow.amount,
    status: 'RELEASED',
    statusLabel: ESCROW_STATE_LABELS.RELEASED,
    escrowStatus: 'released',
    workStatus: 'completed',
    workStatusLabel: 'Completed',
    releasedAt: escrow.releasedAt,
  };

  io.to(`user:${escrow.freelancerId}`).emit('escrow_released', eventPayload);
  io.to(`user:${escrow.freelancerId}`).emit('wallet_updated', freelancerPayload);
  io.to(`user:${escrow.freelancerId}`).emit('payment_success', {
    ...freelancerPayload,
    transaction: {
      type: 'escrow_released',
      amount: freelancerAmount ?? escrow.amount,
      jobId: eventPayload.jobId,
    },
  });

  io.to(`user:${escrow.clientId}`).emit('escrow_released', eventPayload);
  io.to(`user:${escrow.clientId}`).emit('wallet_updated', buildWalletPayload(clientWallet));
};

module.exports = {
  ESCROW_STATE_LABELS,
  emitEscrowFunded,
  emitEscrowReleased,
  buildWalletPayload,
};
