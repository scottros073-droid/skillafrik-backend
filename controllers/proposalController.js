const Proposal = require('../models/Proposal');
const Job = require('../models/Job');
const Escrow = require('../models/Escrow');
const User = require('../models/User');
const notificationService = require('../services/notificationService');
const { invalidateSummaryCache } = require('../utils/summaryCache');
const { applyHireToJob } = require('../utils/hireWorkflow');
const { buildApplicationRecord } = require('../utils/applicationHelpers');

// Create proposal
const createProposal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { jobId } = req.body;
    const coverLetter = req.body.coverLetter || req.body.message || req.body.proposal || '';
    const proposedRate = req.body.proposedRate || req.body.proposedPrice || req.body.proposedBudget || req.body.offerPrice || req.body.bidAmount;
    const timelineInDays = req.body.timelineInDays || req.body.estimatedDuration || req.body.duration || 7;

    if (!jobId || !coverLetter.trim()) {
      return res.status(400).json({ success: false, message: 'Job ID and proposal message are required' });
    }

    // Check if job exists and is open
    const job = await Job.findById(jobId);
    if (!job || job.status !== 'open') {
      return res.status(400).json({ success: false, message: 'Job not found or not available' });
    }

    if (job.clientId.toString() === userId) {
      return res.status(403).json({ success: false, message: 'Job creator cannot apply to their own job' });
    }

    const existingProposal = await Proposal.findOne({ jobId, freelancerId: userId });
    if (existingProposal) {
      return res.status(400).json({ success: false, message: 'You have already submitted a proposal for this job' });
    }

    const normalizedRate = Number(proposedRate || job.budget || 1);
    const normalizedTimeline = Number(timelineInDays || 7);

    const proposal = await Proposal.create({
      jobId,
      freelancerId: userId,
      clientId: job.clientId,
      coverLetter: coverLetter.trim(),
      proposedRate: Number.isFinite(normalizedRate) && normalizedRate > 0 ? normalizedRate : 1,
      timelineInDays: Number.isFinite(normalizedTimeline) && normalizedTimeline > 0 ? normalizedTimeline : 7,
      status: 'pending'
    });

    const freelancer = await User.findById(userId)
      .select('firstName lastName avatar rating ratingCount reviewCount verified isPremium isTopUser trustScore skills title');
    const applicationRecord = buildApplicationRecord(freelancer || userId, proposal, coverLetter.trim());
    const updatedJob = await Job.findOneAndUpdate(
      {
        _id: jobId,
        status: 'open',
        applications: { $not: { $elemMatch: { freelancerId: req.user._id || req.user.id } } },
      },
      {
        $push: {
          proposals: proposal._id,
          applications: applicationRecord,
        },
      },
      { new: true }
    );

    if (!updatedJob) {
      await Proposal.findByIdAndDelete(proposal._id);
      return res.status(400).json({ success: false, message: 'You have already submitted a proposal for this job' });
    }

    invalidateSummaryCache(job.clientId);
    try {
      const marketplaceRoutes = require('../routes/marketplaceRoutes');
      if (typeof marketplaceRoutes.clearResponseCache === 'function') {
        marketplaceRoutes.clearResponseCache();
      }
    } catch {
      // Marketplace cache clear is best-effort.
    }
    await notificationService.notifyJobApplication(updatedJob, freelancer, req.app?.get?.('io'));

    const io = req.app?.get?.('io');
    if (io) {
      const applicantCount = updatedJob.applications.length;
      io.to(`user:${updatedJob.clientId}`).emit('application_received', {
        jobId: updatedJob._id,
        jobTitle: updatedJob.title,
        proposalId: proposal._id,
        freelancerId: userId,
        applicantCount,
        proposal: proposal.coverLetter,
        price: proposal.proposedRate,
        bidAmount: proposal.proposedRate,
        timelineInDays: proposal.timelineInDays,
        deliveryDays: proposal.timelineInDays,
      });
      io.emit('job_applicant_count_updated', { jobId: updatedJob._id, applicantCount });
    }

    res.status(201).json({
      success: true,
      data: {
        message: 'Proposal submitted successfully',
        applicantCount: updatedJob.applications.length,
        proposal: {
          id: proposal._id,
          jobId: proposal.jobId,
          coverLetter: proposal.coverLetter,
          proposedRate: proposal.proposedRate,
          timelineInDays: proposal.timelineInDays,
          status: proposal.status,
          submittedAt: proposal.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Error creating proposal:', error);
    res.status(500).json({ success: false, message: 'Failed to create proposal' });
  }
};

// Get proposals for job (client only)
const getProposalsForJob = async (req, res) => {
  try {
    const userId = req.user.id;
    const { jobId } = req.params;

    // Check if user owns the job
    const job = await Job.findById(jobId);
    if (!job || job.clientId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const proposals = await Proposal.find({ jobId })
      .populate('freelancerId', 'firstName lastName email avatar rating')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: proposals.map(proposal => ({
        id: proposal._id,
        freelancer: {
          id: proposal.freelancerId._id,
          name: `${proposal.freelancerId.firstName} ${proposal.freelancerId.lastName}`,
          email: proposal.freelancerId.email,
          avatar: proposal.freelancerId.avatar,
          rating: proposal.freelancerId.rating
        },
        coverLetter: proposal.coverLetter,
        proposedRate: proposal.proposedRate,
        timelineInDays: proposal.timelineInDays,
        status: proposal.status,
        submittedAt: proposal.createdAt
      }))
    });
  } catch (error) {
    console.error('Error getting proposals:', error);
    res.status(500).json({ success: false, message: 'Failed to get proposals' });
  }
};

// Accept proposal
const acceptProposal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const proposal = await Proposal.findById(id).populate('jobId freelancerId');
    if (!proposal) {
      return res.status(404).json({ success: false, message: 'Proposal not found' });
    }

    if (proposal.jobId.clientId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (proposal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Proposal is not pending' });
    }

    proposal.status = 'accepted';
    proposal.acceptedAt = new Date();
    await proposal.save();

    const job = proposal.jobId;
    const freelancer = proposal.freelancerId;

    // Send notification to accepted freelancer
    await notificationService.notifyJobAccepted(job, freelancer);

    const rejectedProposals = await Proposal.find({
      jobId: proposal.jobId._id,
      _id: { $ne: id }
    }).select('freelancerId');

    await Proposal.updateMany(
      { jobId: proposal.jobId._id, _id: { $ne: id } },
      { status: 'rejected', rejectedAt: new Date() }
    );

    if (!job) {
      return res.status(500).json({ success: false, message: 'Associated job not found' });
    }

    applyHireToJob(job, proposal.freelancerId._id, job.clientId);
    if (!job.proposals.some((id) => String(id) === String(proposal._id))) {
      job.proposals.push(proposal._id);
    }
    await job.save();

    const escrow = await Escrow.create({
      jobId: proposal.jobId._id,
      clientId: job.clientId,
      freelancerId: proposal.freelancerId._id,
      amount: proposal.proposedRate || job.budget,
      status: 'PENDING',
      autoReleaseDateAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    job.escrowId = escrow._id;
    job.escrowStatus = 'pending';
    job.escrowAmount = job.budget;
    job.escrowAutoReleaseDate = escrow.autoReleaseDateAt;
    await job.save();

    try {
      await notificationService.notifyJobAssigned(job, freelancer, false);
      await notificationService.notifyClientFreelancerHired(job, freelancer);
      await Promise.all(rejectedProposals.map((rejected) => (
        notificationService.notifyApplicantNotSelected(job, rejected.freelancerId)
          .catch((notificationError) => {
            console.error('Not selected notification failed:', notificationError);
          })
      )));
    } catch (notificationError) {
      console.error('Proposal acceptance notifications failed:', notificationError);
    }

    return res.json({
      success: true,
      data: {
        message: 'Proposal accepted successfully',
        jobId: proposal.jobId._id,
        freelancerId: proposal.freelancerId._id,
        escrowId: escrow._id
      }
    });
  } catch (error) {
    console.error('Error accepting proposal:', error);
    res.status(500).json({ success: false, message: 'Failed to accept proposal' });
  }
};

// Reject proposal
const rejectProposal = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const proposal = await Proposal.findById(id).populate('jobId');
    if (!proposal) {
      return res.status(404).json({ success: false, message: 'Proposal not found' });
    }

    // Check if user owns the job
    if (proposal.jobId.clientId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    proposal.status = 'rejected';
    await proposal.save();

    if (proposal.jobId && Array.isArray(proposal.jobId.applications)) {
      const application = proposal.jobId.applications.find((item) => String(item.freelancerId) === String(proposal.freelancerId));
      if (application) {
        application.status = 'not_selected';
        await proposal.jobId.save();
      }
    }

    res.json({ message: 'Proposal rejected successfully' });
  } catch (error) {
    console.error('Error rejecting proposal:', error);
    res.status(500).json({ success: false, message: 'Failed to reject proposal' });
  }
};

// Get user's proposals (freelancer)
const getUserProposals = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    const query = { freelancerId: userId };
    if (status) {
      query.status = status;
    }

    const proposals = await Proposal.find(query)
      .populate('jobId', 'title budget status category')
      .sort({ createdAt: -1 });

    res.json({
      proposals: proposals.map(proposal => ({
        id: proposal._id,
        job: {
          id: proposal.jobId._id,
          title: proposal.jobId.title,
          budget: proposal.jobId.budget,
          status: proposal.jobId.status,
          category: proposal.jobId.category
        },
        coverLetter: proposal.coverLetter,
        proposedRate: proposal.proposedRate,
        timelineInDays: proposal.timelineInDays,
        status: proposal.status,
        submittedAt: proposal.createdAt
      }))
    });
  } catch (error) {
    console.error('Error getting user proposals:', error);
    res.status(500).json({ success: false, message: 'Failed to get proposals' });
  }
};

module.exports = {
  createProposal,
  getProposalsForJob,
  acceptProposal,
  rejectProposal,
  getUserProposals
};
