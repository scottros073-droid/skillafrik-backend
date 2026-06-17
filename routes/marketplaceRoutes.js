const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const User = require('../models/User');

const responseCache = new Map();
const CACHE_TTL_MS = 30 * 1000;
const MAX_LIMIT = 48;

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getCacheKey = (query) => JSON.stringify({
  search: query.search || '',
  category: query.category || '',
  section: query.section || query.listingType || '',
  page: query.page || '1',
  limit: query.limit || '24',
});

const readCache = (key) => {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return cached.data;
};

const writeCache = (key, data) => {
  responseCache.set(key, { data, timestamp: Date.now() });
  if (responseCache.size > 100) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
};

const normalizeJob = (job) => {
  const applications = Array.isArray(job.applications) ? job.applications : [];
  const applicantCount = applications.length;
  const unreadApplications = applications.filter((application) => !application?.viewedByClient).length;
  const freelancer = job.freelancerId || job.createdBy || job.clientId || null;
  const premiumPlacement = Boolean(job.premiumPlacement || freelancer?.isPremium);
  return {
    _id: job._id,
    title: job.title,
    description: job.description,
    category: job.category,
    subcategory: job.subcategory,
    skills: job.skills || [],
    budget: job.budget,
    price: job.quickHirePrice || job.budget || 0,
    currency: job.currency || 'NGN',
    status: job.status,
    listingType: job.listingType || (job.category === 'local' ? 'local_job' : 'remote_project'),
    location: job.location,
    address: job.address,
    jobType: job.jobType,
    featured: Boolean(job.featured || job.isFeatured || job.isBoosted),
    isFeatured: Boolean(job.featured || job.isFeatured || job.isBoosted),
    isBoosted: Boolean(job.isBoosted),
    premiumPlacement,
    visibility: {
      profileBoost: premiumPlacement,
      featuredPlacement: premiumPlacement || Boolean(job.featured || job.isFeatured || job.isBoosted),
    },
    boostCount: job.boostCount || 0,
    viewCount: job.viewCount || 0,
    applicantCount,
    applicationsCount: applicantCount,
    proposalsCount: applicantCount,
    unreadApplications,
    createdAt: job.createdAt,
    freelancer,
    createdBy: job.createdBy,
    clientId: job.clientId,
  };
};

router.get('/', async (req, res) => {
  try {
    const cacheKey = getCacheKey(req.query);
    const cached = readCache(cacheKey);
    if (cached) {
      res.set('Cache-Control', 'private, max-age=15');
      return res.status(200).json({ success: true, cached: true, data: cached });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const requestedLimit = Math.max(parseInt(req.query.limit, 10) || 24, 1);
    const limit = Math.min(requestedLimit, MAX_LIMIT);
    const skip = (page - 1) * limit;
    const { category, search } = req.query;
    const section = String(req.query.section || req.query.listingType || '').toLowerCase();

    const filters = { status: 'open' };

    if (['local_job', 'remote_project', 'service'].includes(section)) {
      if (section === 'local_job') {
        filters.$or = [
          { listingType: 'local_job' },
          { listingType: { $in: [null, undefined] }, category: 'local' },
        ];
      } else if (section === 'remote_project') {
        filters.$or = [
          { listingType: 'remote_project' },
          { listingType: { $in: [null, undefined] }, category: 'remote' },
        ];
      } else {
        filters.listingType = 'service';
      }
    }

    if (category) {
      filters.$or = [
        { category },
        { subcategory: category },
        { skills: { $in: [category] } },
      ];
    }

    if (search) {
      const regex = new RegExp(escapeRegex(search.trim()), 'i');
      const searchClause = [
        { title: regex },
        { description: regex },
        { skills: regex },
        { subcategory: regex },
        { 'location.city': regex },
        { 'location.state': regex },
      ];

      if (filters.$or) {
        filters.$and = [{ $or: filters.$or }, { $or: searchClause }];
        delete filters.$or;
      } else {
        filters.$or = searchClause;
      }
    }

    const jobProjection = 'title description category listingType subcategory skills budget currency status location address jobType quickHirePrice featured isFeatured isBoosted boostCount viewCount createdAt createdBy clientId freelancerId applications';
    const userProjection = 'firstName lastName avatar title bio skills rating ratingCount reviewCount totalCompletedJobs totalEarnings isPremium isTopUser verified hourlyRate lastActive';

    const jobsQuery = Job.find(filters)
      .select(jobProjection)
      .populate('createdBy', userProjection)
      .populate('clientId', userProjection)
      .populate('freelancerId', userProjection)
      .sort({ isFeatured: -1, isBoosted: -1, boostCount: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const featuredJobsQuery = Job.find({ status: 'open', $or: [{ featured: true }, { isFeatured: true }, { isBoosted: true }] })
      .select(jobProjection)
      .populate('createdBy', userProjection)
      .populate('clientId', userProjection)
      .sort({ featured: -1, isFeatured: -1, boostCount: -1, createdAt: -1 })
      .limit(8)
      .lean();

    const freelancersQuery = User.find({ userType: 'freelancer', status: { $nin: ['suspended', 'banned'] } })
      .select(userProjection)
      .sort({ isTopUser: -1, isPremium: -1, rating: -1, totalCompletedJobs: -1, lastActive: -1 })
      .limit(12)
      .lean();

    const [jobs, featuredJobs, freelancers, total] = await Promise.all([
      jobsQuery,
      featuredJobsQuery,
      freelancersQuery,
      Job.countDocuments(filters),
    ]);

    const byVisibility = (left, right) =>
      Number(right.featured) - Number(left.featured) ||
      Number(right.isBoosted) - Number(left.isBoosted) ||
      Number(right.premiumPlacement) - Number(left.premiumPlacement) ||
      (right.boostCount || 0) - (left.boostCount || 0) ||
      new Date(right.createdAt || 0) - new Date(left.createdAt || 0);

    const normalizedJobs = jobs.map(normalizeJob).sort(byVisibility);
    const localJobs = normalizedJobs.filter((job) => job.listingType === 'local_job' || (!job.listingType && job.category === 'local'));
    const remoteProjects = normalizedJobs.filter((job) => {
      if (job.listingType === 'service') return false;
      if (job.listingType === 'remote_project') return true;
      const creatorType = String(job.createdBy?.userType || '').toLowerCase();
      return job.category === 'remote' && creatorType !== 'freelancer';
    });
    const services = normalizedJobs.filter((job) => job.listingType === 'service');
    const normalizedFeaturedJobs = featuredJobs.map(normalizeJob).sort(byVisibility);
    const suggestions = Array.from(new Set([
      ...normalizedJobs.flatMap((job) => job.skills || []),
      ...normalizedJobs.map((job) => job.subcategory),
      ...freelancers.flatMap((freelancer) => freelancer.skills || []),
    ].filter(Boolean))).slice(0, 10);

    const payload = {
      jobs: normalizedJobs,
      localJobs,
      remoteProjects,
      services,
      featuredJobs: normalizedFeaturedJobs,
      freelancers,
      trendingFreelancers: freelancers,
      recommendations: normalizedFeaturedJobs.length ? normalizedFeaturedJobs : normalizedJobs.slice(0, 6),
      suggestions,
      analytics: {
        totalJobs: total,
        localJobs: localJobs.length,
        remoteProjects: remoteProjects.length,
        services: services.length,
        featuredJobs: normalizedFeaturedJobs.length,
        freelancers: freelancers.length,
      },
      pagination: {
        total,
        page,
        limit,
        pages: Math.max(Math.ceil(total / limit), 1),
      },
    };

    writeCache(cacheKey, payload);
    res.set('Cache-Control', 'private, max-age=15');
    return res.status(200).json({ success: true, data: payload });
  } catch (err) {
    console.error('Marketplace feed error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to get marketplace',
    });
  }
});

router.clearResponseCache = () => {
  responseCache.clear();
};

module.exports = router;
