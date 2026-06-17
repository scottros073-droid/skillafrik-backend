const mongoose = require('mongoose');
const Job = require('../models/Job');
const User = require('../models/User');

const isValidMongoId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));

const getClientApplicationStats = async (userId) => {
  if (!isValidMongoId(userId)) {
    return {
      applicationsReceived: 0,
      unreadApplications: 0,
      latestApplicants: [],
    };
  }

  const jobs = await Job.find({ clientId: userId })
    .select('title applications')
    .lean();

  let applicationsReceived = 0;
  let unreadApplications = 0;
  const latestApplicants = [];

  for (const job of jobs) {
    const applications = Array.isArray(job.applications) ? job.applications : [];
    applicationsReceived += applications.length;

    for (const application of applications) {
      if (!application?.viewedByClient) unreadApplications += 1;

      latestApplicants.push({
        jobId: job._id,
        jobTitle: job.title,
        applicationId: application._id,
        freelancerId: application.freelancerId,
        proposalId: application.proposalId || null,
        proposal: application.message || '',
        price: application.offerPrice || application.bidAmount || 0,
        bidAmount: application.offerPrice || application.bidAmount || 0,
        timelineInDays: application.timelineInDays || null,
        deliveryDays: application.timelineInDays || null,
        status: application.status || 'pending',
        appliedAt: application.appliedAt || application.createdAt || null,
        viewedByClient: Boolean(application.viewedByClient),
      });
    }
  }

  latestApplicants.sort((a, b) => new Date(b.appliedAt || 0) - new Date(a.appliedAt || 0));
  const topApplicants = latestApplicants.slice(0, 5);
  const freelancerIds = [...new Set(topApplicants.map((item) => String(item.freelancerId)).filter(isValidMongoId))];

  if (freelancerIds.length) {
    const freelancers = await User.find({ _id: { $in: freelancerIds } })
      .select('firstName lastName avatar title rating verified')
      .lean();
    const freelancerMap = new Map(freelancers.map((user) => [String(user._id), user]));

    topApplicants.forEach((entry) => {
      const freelancer = freelancerMap.get(String(entry.freelancerId));
      if (!freelancer) return;
      entry.freelancer = {
        id: freelancer._id,
        name: [freelancer.firstName, freelancer.lastName].filter(Boolean).join(' ') || 'Freelancer',
        avatar: freelancer.avatar || '',
        title: freelancer.title || '',
        rating: freelancer.rating || 0,
        verified: Boolean(freelancer.verified),
      };
    });
  }

  return {
    applicationsReceived,
    unreadApplications,
    latestApplicants: topApplicants,
  };
};

module.exports = {
  getClientApplicationStats,
};
