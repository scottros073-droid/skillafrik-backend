const normalizeFreelancerSnapshot = (freelancer = {}) => {
  const name = [freelancer.firstName, freelancer.lastName]
    .filter(Boolean)
    .join(' ') || freelancer.name || 'Freelancer';

  return {
    freelancerName: name,
    freelancerAvatar: freelancer.avatar || null,
    freelancerRating: Number(freelancer.rating || 0),
    freelancerRatingCount: Number(freelancer.ratingCount || freelancer.reviewCount || 0),
    freelancerTrustScore: Number(freelancer.trustScore || 50),
    freelancerTitle: freelancer.title || '',
    freelancerSkills: Array.isArray(freelancer.skills) ? freelancer.skills : [],
    freelancerVerified: Boolean(freelancer.verified),
    freelancerIsPremium: Boolean(freelancer.isPremium),
    freelancerIsTopUser: Boolean(freelancer.isTopUser),
  };
};

const buildApplicationRecord = (freelancer, proposal, message = '') => ({
  freelancerId: freelancer?._id || freelancer,
  proposalId: proposal._id,
  offerPrice: proposal.proposedRate,
  bidAmount: proposal.proposedRate,
  message: message || proposal.coverLetter,
  proposal: message || proposal.coverLetter,
  timelineInDays: proposal.timelineInDays || null,
  deliveryDays: proposal.timelineInDays || null,
  status: proposal.status || 'pending',
  viewedByClient: false,
  appliedAt: proposal.createdAt || new Date(),
  ...normalizeFreelancerSnapshot(freelancer),
});

const resolveFreelancerForApplication = (application, proposal, applicant) => {
  const source = applicant || {
    name: application.freelancerName || 'Freelancer',
    avatar: application.freelancerAvatar,
    rating: application.freelancerRating || 0,
    ratingCount: application.freelancerRatingCount || 0,
    trustScore: application.freelancerTrustScore || 50,
    title: application.freelancerTitle || '',
    skills: application.freelancerSkills || [],
    verified: application.freelancerVerified || false,
    isPremium: application.freelancerIsPremium || false,
    isTopUser: application.freelancerIsTopUser || false,
  };

  const name = applicant
    ? [source.firstName, source.lastName].filter(Boolean).join(' ').trim() || source.name
    : source.name;

  return {
    id: applicant?._id || application.freelancerId,
    name: name || 'Freelancer',
    avatar: source.avatar || '',
    rating: source.rating || 0,
    ratingCount: source.ratingCount || 0,
    verified: Boolean(source.verified),
    isPremium: Boolean(source.isPremium),
    isTopUser: Boolean(source.isTopUser),
    trustScore: source.trustScore || 50,
    skills: Array.isArray(source.skills) ? source.skills : [],
    title: source.title || '',
  };
};

module.exports = {
  buildApplicationRecord,
  normalizeFreelancerSnapshot,
  resolveFreelancerForApplication,
};
