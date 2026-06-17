// backend/controllers/jobController.js

const Job = require('../models/Job');
const Escrow = require('../models/Escrow');
const Proposal = require('../models/Proposal');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { containsBlockedCommunication } = require('../utils/spamFilter');
const notificationService = require('../services/notificationService');
const { invalidateSummaryCache } = require('../utils/summaryCache');
const { applyHireToJob, isJobApplicant } = require('../utils/hireWorkflow');
const { enrichJobWithWorkStatus } = require('../utils/workStatus');
const { buildApplicationRecord, normalizeFreelancerSnapshot, resolveFreelancerForApplication } = require('../utils/applicationHelpers');
const JOB_TITLE_MIN_LENGTH = 5;

const parseMaybeJson = (value) => {
  if (!value || typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const toBoolean = (value) => value === true || value === 'true' || value === '1';

const buildInlineImageUrl = (file) => {
  if (!file?.buffer) return null;
  return `data:${file.mimetype || 'image/jpeg'};base64,${file.buffer.toString('base64')}`;
};

const getUploadedJobImages = (req) => {
  const files = [
    ...(Array.isArray(req.files?.image) ? req.files.image : []),
    ...(Array.isArray(req.files?.images) ? req.files.images : [])
  ];
  return files.map(buildInlineImageUrl).filter(Boolean);
};

const normalizeStatus = (status = '') => {
  if (!status) return undefined;
  return String(status).toLowerCase();
};

const jobOwnedByUser = (job, userId) => {
  const ownerId = job?.clientId?.toString() || job?.createdBy?.toString();
  return ownerId === String(userId);
};

const mapApplicationForClient = (application, proposal, applicant) => {
  const freelancerId = applicant?._id?.toString() || application.freelancerId?.toString();
  const bidAmount = proposal?.proposedRate || application.offerPrice || application.bidAmount || 0;
  const timelineInDays = proposal?.timelineInDays || application.timelineInDays || application.deliveryDays || null;
  const freelancer = resolveFreelancerForApplication(application, proposal, applicant);

  return {
    id: application._id,
    proposalId: proposal?._id || application.proposalId,
    freelancerId,
    freelancer,
    proposal: proposal?.coverLetter || application.message || application.proposal || '',
    price: bidAmount,
    bidAmount,
    timelineInDays,
    deliveryDays: timelineInDays,
    deliveryEstimate: timelineInDays ? `${timelineInDays} days` : null,
    status: (() => {
      const raw = application.status || proposal?.status || 'pending';
      if (raw === 'accepted') return 'accepted';
      if (raw === 'not_selected' || raw === 'rejected') return 'not_selected';
      return raw;
    })(),
    viewedByClient: Boolean(application.viewedByClient),
    appliedAt: application.appliedAt || proposal?.createdAt,
  };
};

const syncApplicationsFromProposals = async (job) => {
  const proposals = await Proposal.find({ jobId: job._id })
    .populate('freelancerId', 'firstName lastName avatar rating ratingCount reviewCount verified isPremium isTopUser trustScore skills title');
  if (!proposals.length) return false;

  const existingApplications = job.applications || [];

  let changed = false;
  for (const proposal of proposals) {
    const freelancerId = String(proposal.freelancerId?._id || proposal.freelancerId);
    const existingApplication = existingApplications.find((application) => String(application.freelancerId) === freelancerId);
    const statusFromProposal = proposal.status === 'accepted'
      ? 'accepted'
      : proposal.status === 'rejected'
        ? 'not_selected'
        : existingApplication?.status || 'pending';

    if (existingApplication) {
      if (existingApplication.status !== statusFromProposal) {
        existingApplication.status = statusFromProposal;
        changed = true;
      }

      const snapshot = normalizeFreelancerSnapshot(proposal.freelancerId);
      Object.keys(snapshot).forEach((key) => {
        if (snapshot[key] !== undefined && existingApplication[key] === undefined) {
          existingApplication[key] = snapshot[key];
          changed = true;
        }
      });
    } else {
      job.applications.push(buildApplicationRecord(proposal.freelancerId, proposal, proposal.coverLetter));
      existingIds.add(freelancerId);
      changed = true;
    }
  }

  if (changed) {
    await job.save();
    invalidateSummaryCache(job.clientId);
  }

  return changed;
};

const emitApplicationEvents = (req, job, proposal, freelancer, applicationEvent) => {
  invalidateSummaryCache(job.clientId);

  try {
    const marketplaceRoutes = require('../routes/marketplaceRoutes');
    if (typeof marketplaceRoutes.clearResponseCache === 'function') {
      marketplaceRoutes.clearResponseCache();
    }
  } catch {
    // Marketplace cache clear is best-effort.
  }

  notificationService.notifyJobApplication(job, freelancer, req.app.get('io')).catch((notificationError) => {
    console.error('Application received notification failed:', notificationError);
  });

  const io = req.app.get('io');
  if (!io) return;

  io.to(`user:${job.clientId}`).emit('application_received', applicationEvent);
  io.to(`user:${job.clientId}`).emit('job_applicant_count_updated', {
    jobId: job._id,
    applicantCount: applicationEvent.applicantCount,
  });
  io.emit('job_applicant_count_updated', {
    jobId: job._id,
    applicantCount: applicationEvent.applicantCount,
  });
};

// ===== ANTI-SCAM DETECTION FUNCTIONS =====

/**
 * Detects suspicious keywords and patterns in job title/description
 * Returns array of suspicious keywords found
 */
const detectSuspiciousKeywords = (title, description) => {
  const suspiciousPatterns = [
    /make\s+money\s+fast/gi,
    /guaranteed\s+income/gi,
    /risk\s+free/gi,
    /no\s+experience\s+needed/gi,
    /work\s+from\s+home\s+guaranteed/gi,
    /unlimited\s+earnings/gi,
    /easy\s+cash/gi,
    /get\s+paid\s+instantly/gi,
    /click\s+button\s+earn/gi,
    /no\s+work\s+needed/gi,
    /passive\s+income\s+forever/gi,
    /secret\s+method/gi,
    /once\s+in\s+lifetime/gi,
    /must\s+act\s+now/gi,
    /limited\s+time\s+offer/gi
  ];

  const fullText = `${title || ''} ${description || ''}`.toLowerCase();
  const foundPatterns = [];

  suspiciousPatterns.forEach(pattern => {
    const matches = fullText.match(pattern);
    if (matches) {
      foundPatterns.push(...matches);
    }
  });

  return [...new Set(foundPatterns)];
};

/**
 * Detects impossible or unrealistic requirements
 * Returns array of unrealistic requirements detected
 */
const detectUnrealisticRequirements = (description, budget, deadline) => {
  const issues = [];
  const desc = (description || '').toLowerCase();

  // Check for unrealistic expertise demands
  if (desc.includes('10 years') && desc.includes('php') && desc.includes('python') && 
      desc.includes('java') && desc.includes('node') && budget < 1000) {
    issues.push('unrealistic_expertise_demand_low_budget');
  }

  // Check for impossible quick turnaround
  if (deadline) {
    const daysUntilDeadline = (new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24);
    if (daysUntilDeadline < 1 && desc.includes('complete') && desc.includes('project')) {
      issues.push('impossible_deadline');
    }
  }

  // Check for vague requirements with high budget
  if (budget > 100000 && desc.length < 100) {
    issues.push('vague_requirements_high_budget');
  }

  return issues;
};

/**
 * Checks for duplicate jobs from same user
 * Returns count of similar jobs in last 24 hours
 */
const checkDuplicateJobs = async (userId, title, description, budget) => {
  try {
    // Look for exact or very similar jobs in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const duplicates = await Job.find({
      createdBy: userId,
      createdAt: { $gte: oneDayAgo },
      $or: [
        { title: { $regex: title.substring(0, 20), $options: 'i' } },
        { description: { $regex: description.substring(0, 30), $options: 'i' } }
      ]
    }).limit(5);

    return duplicates.length;
  } catch (err) {
    console.error('Duplicate job check error:', err);
    return 0;
  }
};

/**
 * Checks for spam posting patterns
 * Returns true if user is posting too many jobs in short timeframe
 */
const checkSpamPosting = async (userId) => {
  try {
    // Check jobs posted in last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentJobs = await Job.countDocuments({
      createdBy: userId,
      createdAt: { $gte: oneHourAgo }
    });

    // If more than 5 jobs in 1 hour, likely spam
    if (recentJobs >= 5) return true;

    // Check jobs posted in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dailyJobs = await Job.countDocuments({
      createdBy: userId,
      createdAt: { $gte: oneDayAgo }
    });

    // If more than 20 jobs in 24 hours, likely spam
    if (dailyJobs >= 20) return true;

    return false;
  } catch (err) {
    console.error('Spam posting check error:', err);
    return false;
  }
};

/**
 * Calculates overall scam score (0-100)
 * Returns { score, reasons, status }
 */
const calculateScamScore = async (userId, title, description, budget, deadline, category) => {
  let score = 0;
  const reasons = [];
  const [duplicateCount, isSpamPosting, user] = await Promise.all([
    checkDuplicateJobs(userId, title, description, budget),
    checkSpamPosting(userId),
    User.findById(userId).select('trustScore rating complaints').catch(() => null)
  ]);

  // ===== ZERO/SUSPICIOUSLY LOW BUDGET CHECK =====
  if (budget <= 0) {
    score += 30;
    reasons.push('zero_budget');
  } else if (budget < 50 && category === 'remote') {
    // Very low budget for remote work might indicate scam or test posting
    score += 15;
  }

  // ===== SUSPICIOUS KEYWORDS CHECK =====
  const suspiciousKeywords = detectSuspiciousKeywords(title, description);
  if (suspiciousKeywords.length > 0) {
    score += Math.min(25, suspiciousKeywords.length * 5);
    reasons.push('suspicious_keywords');
  }

  // ===== DUPLICATE JOB CHECK =====
  if (duplicateCount > 0) {
    score += Math.min(20, duplicateCount * 10);
    reasons.push('duplicate_job');
  }

  // ===== SPAM POSTING CHECK =====
  if (isSpamPosting) {
    score += 25;
    reasons.push('spam_posting');
  }

  // ===== UNREALISTIC REQUIREMENTS CHECK =====
  const unrealisticIssues = detectUnrealisticRequirements(description, budget, deadline);
  if (unrealisticIssues.length > 0) {
    score += Math.min(20, unrealisticIssues.length * 10);
    unrealisticIssues.forEach(issue => {
      if (issue === 'vague_requirements_high_budget') {
        reasons.push('vague_requirements');
      } else if (issue === 'impossible_deadline') {
        reasons.push('unrealistic_deadline');
      }
    });
  }

  // ===== USER REPUTATION CHECK =====
  if (user && user.trustScore && user.trustScore < 30) {
    score += 15;
    reasons.push('low_user_rating');
  }

  // Cap score at 100
  score = Math.min(100, score);

  // Determine scam status
  let status = 'safe';
  if (score >= 70) {
    status = 'blocked'; // High scam risk - block immediately
  } else if (score >= 40) {
    status = 'suspicious'; // Medium scam risk - flag for review
  }

  return {
    score: Math.round(score),
    reasons: [...new Set(reasons)], // Remove duplicates
    status
  };
};

const buildJobFilters = (query) => {
  const filters = {};
  const andConditions = [];

  if (query.category) {
    const requestedCategory = String(query.category).trim();
    if (['remote', 'local'].includes(requestedCategory.toLowerCase())) {
      filters.category = requestedCategory.toLowerCase();
    } else {
      andConditions.push({
        $or: [
          { subcategory: { $regex: requestedCategory, $options: 'i' } },
          { skills: { $regex: requestedCategory, $options: 'i' } }
        ]
      });
    }
  }
  if (query.subcategory) filters.subcategory = query.subcategory;
  if (query.status) filters.status = normalizeStatus(query.status);
  if (query.type) filters.category = query.type;

  if (query.search) {
    andConditions.push({
      $or: [
        { title: { $regex: query.search, $options: 'i' } },
        { description: { $regex: query.search, $options: 'i' } },
        { subcategory: { $regex: query.search, $options: 'i' } }
      ]
    });
  }

  if (query.country) filters['location.country'] = query.country;
  if (query.state) filters['location.state'] = query.state;
  if (query.city) filters['location.city'] = query.city;

  if (query.minBudget || query.maxBudget) {
    filters.budget = {};
    if (query.minBudget) filters.budget.$gte = parseFloat(query.minBudget);
    if (query.maxBudget) filters.budget.$lte = parseFloat(query.maxBudget);
  }

  if (andConditions.length) filters.$and = andConditions;

  return filters;
};

const { createReviewRecord } = require('../utils/reviewHelpers');

// ===== CREATE JOB WITH ANTI-SCAM PROTECTION =====
exports.createJob = async (req, res) => {
  try {
    const rawBody = { ...(req.body || {}) };
    rawBody.location = parseMaybeJson(rawBody.location);
    rawBody.coordinates = parseMaybeJson(rawBody.coordinates);
    rawBody.images = parseMaybeJson(rawBody.images);
    rawBody.skills = parseMaybeJson(rawBody.skills);
    rawBody.localDetails = parseMaybeJson(rawBody.localDetails);
    const title = String(rawBody.title || '').trim().replace(/\s+/g, ' ');
    const description = String(rawBody.description || '').trim().replace(/\s+/g, ' ');
    const categoryHint = String(rawBody.category || '').toLowerCase();
    const requestedWorkMode = String(
      rawBody.type ||
      rawBody.workMode ||
      (['remote', 'local'].includes(categoryHint) ? categoryHint : '')
    ).toLowerCase();
    const category = ['remote', 'local'].includes(requestedWorkMode) ? requestedWorkMode : 'remote';
    const subcategory = rawBody.subcategory || (!['remote', 'local'].includes(String(rawBody.category || '').toLowerCase()) ? rawBody.category : '');
    const currency = rawBody.currency || 'NGN';
    const address = rawBody.address || rawBody.location?.address || '';
    const onsiteDetails = String(rawBody.onsiteDetails || rawBody.arrivalDetails || rawBody.localDetails?.onsiteDetails || '').trim();
    const arrivalDateTime = rawBody.arrivalDateTime || rawBody.onsiteDateTime || rawBody.localDetails?.arrivalDateTime || rawBody.deadline || null;
    const contactPhone = rawBody.contactPhone || '';
    const isUrgent = toBoolean(rawBody.isUrgent);
    const isLocal = category === 'local';
    const quickHire = toBoolean(rawBody.quickHire);
    const quickHirePrice = rawBody.quickHirePrice ? parseFloat(rawBody.quickHirePrice) : null;
    const jobType = ['fixed', 'hourly', 'quick_hire'].includes(rawBody.jobType) ? rawBody.jobType : 'fixed';
    
    // ===== VALIDATION BLOCK =====
    // Check required fields
    if (!title || !description) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title and description are required' 
      });
    }

    if (title.length < JOB_TITLE_MIN_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Title must be at least ${JOB_TITLE_MIN_LENGTH} characters`
      });
    }

    if (title.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Title cannot exceed 200 characters'
      });
    }

    if (description.length < 50) {
      return res.status(400).json({
        success: false,
        message: 'Description must be at least 50 characters'
      });
    }

    if (description.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Description cannot exceed 5000 characters'
      });
    }
    
    // Validate budget
    let budget = rawBody.budget !== undefined && rawBody.budget !== null
      ? parseFloat(rawBody.budget)
      : 0;
    
    if (!Number.isFinite(budget) || budget <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Budget must be a positive number greater than 0' 
      });
    }
    
    if (budget > 10000000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Budget cannot exceed 10,000,000' 
      });
    }
    
    // Validate category (type)
    if (!['remote', 'local'].includes(category)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Category must be either "remote" or "local"' 
      });
    }
    
    const state = rawBody.state || rawBody.location?.state || '';
    const city = rawBody.city || rawBody.location?.city || '';

    // Validate local job requirements
    if (category === 'local') {
      if (!String(state).trim() || !String(city).trim()) {
        return res.status(400).json({
          success: false,
          message: 'State and city are required for local jobs'
        });
      }
      if (!String(address).trim() && !String(rawBody.location?.address || '').trim()) {
        return res.status(400).json({
          success: false,
          message: 'Physical address is required for local jobs'
        });
      }
      if (arrivalDateTime && Number.isNaN(new Date(arrivalDateTime).getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Arrival date and time is invalid'
        });
      }
    }
    
    // Validate quick hire requirements
    if (quickHire) {
      if (!quickHirePrice || quickHirePrice <= 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Quick hire price must be a positive number' 
        });
      }
      if (!contactPhone || !contactPhone.trim()) {
        return res.status(400).json({ 
          success: false, 
          message: 'Contact phone is required for quick hire jobs' 
        });
      }
    }
    
    // Validate postedBy (createdBy) exists
    if (!req.user || !req.user._id) {
      return res.status(401).json({ 
        success: false, 
        message: 'User authentication required' 
      });
    }

    const userType = String(req.user.userType || '').toLowerCase();
    const requestedListingType = String(rawBody.listingType || '').toLowerCase();
    let listingType = ['local_job', 'remote_project', 'service'].includes(requestedListingType)
      ? requestedListingType
      : null;

    if (userType === 'client') {
      listingType = category === 'local' ? 'local_job' : 'remote_project';
    } else if (userType === 'freelancer') {
      if (category === 'local' || listingType === 'local_job' || listingType === 'remote_project') {
        return res.status(403).json({
          success: false,
          message: 'Freelancers can create service listings only. Post a service instead of a job.',
        });
      }
      listingType = 'service';
    } else {
      return res.status(403).json({
        success: false,
        message: 'Only clients and freelancers can post marketplace listings'
      });
    }
    
    const deadline = rawBody.deadline || null;
    const estimatedDuration = rawBody.estimatedDuration || null;
    const experienceLevel = rawBody.experienceLevel || 'intermediate';
    const country = rawBody.country || rawBody.location?.country || (category === 'local' ? 'Nigeria' : 'Worldwide');
    const resolvedState = String(state).trim();
    const resolvedCity = String(city).trim();
    let resolvedAddress = String(address || rawBody.location?.address || '').trim();
    if (category === 'local' && !resolvedAddress && resolvedCity && resolvedState) {
      resolvedAddress = `${resolvedCity}, ${resolvedState}`;
    }

    const coordinates = Array.isArray(rawBody.coordinates)
      ? rawBody.coordinates
      : Array.isArray(rawBody.location?.coordinates)
      ? rawBody.location.coordinates
      : rawBody.latitude && rawBody.longitude
      ? [parseFloat(rawBody.longitude), parseFloat(rawBody.latitude)]
      : [0, 0];

    let skills = [];
    if (Array.isArray(rawBody.skills)) {
      skills = rawBody.skills;
    } else if (typeof rawBody.skills === 'string' && rawBody.skills.trim()) {
      skills = rawBody.skills.split(',').map((s) => s.trim()).filter(Boolean);
    }

    const images = getUploadedJobImages(req);
    if (rawBody.images) {
      if (Array.isArray(rawBody.images)) images.push(...rawBody.images.filter(Boolean));
      else images.push(rawBody.images);
    }
    if (rawBody.image) images.push(rawBody.image);
    const jobImages = images.filter(Boolean).slice(0, 5);

    // ===== ANTI-SCAM DETECTION =====
    const scamAnalysis = await calculateScamScore(
      req.user._id,
      title,
      description,
      budget,
      deadline,
      category
    );

    // BLOCK job creation if scam score is too high
    if (scamAnalysis.status === 'blocked') {
      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: 'Job creation blocked: Potential scam detected. Please verify your job posting details.',
        scamInfo: {
          score: scamAnalysis.score,
          reasons: scamAnalysis.reasons,
          recommendation: 'Your job posting contains patterns commonly associated with fraudulent activity. Please review and resubmit with legitimate details.'
        }
      });
    }

    // Create job with scam analysis data
    const job = await Job.create({
      title,
      description,
      category: category.toLowerCase(),
      subcategory,
      images: jobImages,
      budget,
      currency,
      location: {
        country,
        state: resolvedState,
        city: resolvedCity,
        address: resolvedAddress,
        coordinates
      },
      address: resolvedAddress,
      onsiteDetails: category === 'local' ? onsiteDetails : '',
      arrivalDateTime: category === 'local' && arrivalDateTime ? new Date(arrivalDateTime) : null,
      contactPhone: quickHire ? contactPhone : '',
      isLocal,
      isUrgent,
      quickHire,
      quickHirePrice: quickHire ? quickHirePrice : null,
      jobType,
      deadline,
      estimatedDuration,
      skills,
      experienceLevel: (experienceLevel || 'intermediate').toLowerCase(),
      createdBy: req.user._id,
      clientId: req.user._id,
      listingType,
      // ===== ANTI-SCAM FIELDS =====
      scam_status: scamAnalysis.status,
      ai_scam_score: scamAnalysis.score,
      scam_reasons: scamAnalysis.reasons,
      scam_flagged_at: scamAnalysis.status !== 'safe' ? new Date() : null,
      manual_verification: scamAnalysis.status === 'suspicious'
    });

    // If suspicious, job is marked for review but still created
    const responseMessage = scamAnalysis.status === 'suspicious'
      ? 'Job created successfully but flagged for review. You may receive an email once verification is complete.'
      : 'Job created successfully';

    // Send notification about job posting
    notificationService.notifyJobPosted(job, req.user).catch((notificationError) => {
      console.error('Job posted notification failed:', notificationError);
    });

    res.status(201).json({
      success: true,
      statusCode: 201,
      message: responseMessage,
      data: job,
      ...(scamAnalysis.status === 'suspicious' && {
        scamInfo: {
          status: scamAnalysis.status,
          score: scamAnalysis.score,
          reasons: scamAnalysis.reasons,
          note: 'Your job has been flagged for manual review due to potential risk indicators.'
        }
      })
    });
  } catch (err) {
    console.error('Create job error:', err);
    
    // Handle Mongoose validation errors
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors)
        .map(e => e.message)
        .join('; ');
      return res.status(400).json({ 
        success: false, 
        message: `Validation failed: ${messages}` 
      });
    }
    
    res.status(400).json({ 
      success: false, 
      message: err.message || 'Failed to create job' 
    });
  }
};

// ===== GET ALL JOBS =====
exports.getAllJobs = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 48);
    const query = { status: req.query.status || 'open' };
    const andConditions = [];
    if (req.query.country) query["location.country"] = req.query.country;
    if (req.query.state) query["location.state"] = req.query.state;
    if (req.query.city) query["location.city"] = req.query.city;
    if (req.query.category) {
      const categoryFilter = String(req.query.category).toLowerCase();
      if (['remote', 'local'].includes(categoryFilter)) query.category = categoryFilter;
      else {
        const safeCategory = String(req.query.category).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(safeCategory, 'i');
        andConditions.push({
          $or: [
            { subcategory: regex },
            { skills: regex }
          ]
        });
      }
    }
    if (req.query.type || req.query.jobType) {
      const workType = String(req.query.type || req.query.jobType).toLowerCase();
      if (['remote', 'local'].includes(workType)) query.category = workType;
    }
    const listingType = String(req.query.listingType || req.query.section || '').toLowerCase();
    if (['local_job', 'remote_project', 'service'].includes(listingType)) {
      if (listingType === 'local_job') {
        andConditions.push({
          $or: [
            { listingType: 'local_job' },
            { listingType: { $in: [null, undefined] }, category: 'local' },
          ]
        });
      } else if (listingType === 'remote_project') {
        andConditions.push({
          $or: [
            { listingType: 'remote_project' },
            { listingType: { $in: [null, undefined] }, category: 'remote' },
          ]
        });
      } else {
        query.listingType = 'service';
      }
    }
    if (req.query.search) {
      const safeSearch = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(safeSearch, 'i');
      andConditions.push({
        $or: [
          { title: regex },
          { description: regex },
          { skills: regex },
          { subcategory: regex }
        ]
      });
    }
    if (andConditions.length) query.$and = andConditions;

    const skip = (page - 1) * limit;
    const [premiumCreatorIds, total] = await Promise.all([
      User.find({
        isPremium: true,
        status: { $nin: ['suspended', 'banned'] }
      }).distinct('_id'),
      Job.countDocuments(query)
    ]);

    const jobs = await Job.aggregate([
      { $match: query },
      {
        $addFields: {
          premiumPlacement: {
            $cond: [{ $in: ['$createdBy', premiumCreatorIds] }, 1, 0]
          }
        }
      },
      { $sort: { featured: -1, isFeatured: -1, isBoosted: -1, premiumPlacement: -1, boostCount: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          title: 1,
          description: 1,
          category: 1,
          subcategory: 1,
          listingType: 1,
          skills: 1,
          budget: 1,
          currency: 1,
          location: 1,
          address: 1,
          jobType: 1,
          quickHirePrice: 1,
          featured: 1,
          isFeatured: 1,
          isBoosted: 1,
          premiumPlacement: 1,
          boostCount: 1,
          viewCount: 1,
          status: 1,
          createdAt: 1,
          clientId: 1,
          createdBy: 1,
          freelancerId: 1,
          applications: 1,
          images: 1,
          deadline: 1,
          arrivalDateTime: 1,
          onsiteDetails: 1
        }
      }
    ]);

    await Job.populate(jobs, [
      { path: 'clientId', select: 'firstName lastName avatar rating reviewCount isPremium isTopUser verified trustScore userType' },
      { path: 'createdBy', select: 'firstName lastName avatar rating reviewCount isPremium isTopUser verified trustScore userType title bio hourlyRate' },
      { path: 'freelancerId', select: 'firstName lastName avatar rating reviewCount isPremium isTopUser verified trustScore userType title bio hourlyRate' }
    ]);

    let jobsWithApplicantCounts = (jobs || []).map((job) => {
      const applicantCount = Array.isArray(job.applications) ? job.applications.length : 0;
      const { applications, ...safeJob } = job;
      const creator = safeJob.createdBy || safeJob.freelancerId || safeJob.clientId || {};
      const hasPremiumPlacement = Boolean(safeJob.premiumPlacement || creator.isPremium);
      return {
        ...safeJob,
        applicantCount,
        premiumPlacement: hasPremiumPlacement,
        visibility: {
          ...(safeJob.visibility || {}),
          profileBoost: hasPremiumPlacement,
          featuredPlacement: hasPremiumPlacement || Boolean(safeJob.featured || safeJob.isFeatured || safeJob.isBoosted)
        }
      };
    });

    if (listingType === 'remote_project') {
      jobsWithApplicantCounts = jobsWithApplicantCounts.filter((job) => {
        if (job.listingType === 'service') return false;
        if (job.listingType === 'remote_project') return true;
        const creatorType = String(job.createdBy?.userType || '').toLowerCase();
        return job.category === 'remote' && creatorType !== 'freelancer';
      });
    } else if (listingType === 'local_job') {
      jobsWithApplicantCounts = jobsWithApplicantCounts.filter((job) => {
        if (job.listingType === 'local_job') return true;
        return !job.listingType && job.category === 'local';
      });
    } else if (listingType === 'service') {
      jobsWithApplicantCounts = jobsWithApplicantCounts.filter((job) => job.listingType === 'service');
    }

    res.json({
      success: true,
      data: jobsWithApplicantCounts,
      pagination: {
        total: listingType ? jobsWithApplicantCounts.length : total,
        page,
        limit,
        pages: Math.max(Math.ceil(total / limit), 1)
      }
    });
  } catch (error) {
    console.error("Jobs error:", error);
    res.status(500).json({ success: false, message: 'Failed to get jobs' });
  }
};

// ===== GET JOB RECOMMENDATIONS (AI) =====
exports.getJobRecommendations = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get user's profile and skills
    const user = await User.findById(userId).select('skills experienceLevel categories');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Simple AI matching: match by skills and experience
    const filters = {
      status: 'open',
      skills: { $in: user.skills || [] },
      experienceLevel: user.experienceLevel || 'intermediate'
    };

    const recommendations = await Job.find(filters)
      .populate('createdBy', 'firstName lastName avatar rating reviewCount')
      .limit(10)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      statusCode: 200,
      message: 'Job recommendations retrieved',
      data: recommendations
    });
  } catch (err) {
    console.error('Get job recommendations error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve job recommendations' });
  }
};

// ===== GET NEARBY JOBS =====
exports.getNearbyJobs = async (req, res) => {
  try {
    const { lat, lng, radius = 50 } = req.query; // radius in km

    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude required' });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radiusKm = parseFloat(radius);

    // Find jobs within radius, preferring local jobs
    const jobs = await Job.find({
      status: 'open',
      $or: [
        { category: 'local' },
        {
          'location.coordinates': {
            $near: {
              $geometry: {
                type: 'Point',
                coordinates: [longitude, latitude]
              },
              $maxDistance: radiusKm * 1000 // convert to meters
            }
          }
        }
      ]
    })
    .populate('createdBy', 'firstName lastName avatar rating reviewCount')
    .limit(20)
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      statusCode: 200,
      message: 'Nearby jobs retrieved',
      data: jobs
    });
  } catch (err) {
    console.error('Get nearby jobs error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve nearby jobs' });
  }
};

// ===== GET JOB BY ID =====
exports.getJobById = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('createdBy', 'firstName lastName avatar rating reviewCount')
      .populate('clientId', 'firstName lastName avatar email')
      .populate('freelancerId', 'firstName lastName avatar rating')
      .populate('proposals');

    if (!job) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    job.viewCount = (job.viewCount || 0) + 1;
    await job.save();

    const data = enrichJobWithWorkStatus(job);
    data.applicantCount = Array.isArray(data.applications) ? data.applications.length : 0;
    data.client = data.clientId;

    res.json({
      success: true,
      statusCode: 200,
      message: 'Job retrieved',
      data,
    });
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve job details' });
  }
};

// ===== UPDATE JOB =====
exports.updateJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (job.clientId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized - only job creator can edit' });
    }

    if (['in_progress', 'delivered', 'completed', 'cancelled', 'disputed'].includes(job.status)) {
      return res.status(400).json({ success: false, message: 'Cannot edit job in current status' });
    }

    const rawBody = { ...(req.body || {}) };
    rawBody.location = parseMaybeJson(rawBody.location);
    rawBody.images = parseMaybeJson(rawBody.images);
    rawBody.skills = parseMaybeJson(rawBody.skills);

    const {
      title,
      description,
      category,
      subcategory,
      budget,
      currency,
      country,
      state,
      city,
      address,
      contactPhone,
      deadline,
      estimatedDuration,
      skills,
      experienceLevel,
      isUrgent,
      quickHire,
      quickHirePrice
    } = rawBody;

    const uploadedImages = getUploadedJobImages(req);
    if (rawBody.images) {
      if (Array.isArray(rawBody.images)) uploadedImages.push(...rawBody.images.filter(Boolean));
      else uploadedImages.push(rawBody.images);
    }
    if (rawBody.image) uploadedImages.push(rawBody.image);

    // ===== VALIDATION BLOCK FOR UPDATES =====
    // Validate budget if provided
    if (budget !== undefined && budget !== null) {
      const budgetNum = parseFloat(budget);
      if (!Number.isFinite(budgetNum) || budgetNum <= 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Budget must be a positive number greater than 0' 
        });
      }
      if (budgetNum > 10000000) {
        return res.status(400).json({ 
          success: false, 
          message: 'Budget cannot exceed 10,000,000' 
        });
      }
      job.budget = budgetNum;
    }
    
    // Validate category if provided
    if (category && !['remote', 'local'].includes(category)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Category must be either "remote" or "local"' 
      });
    }
    
    // Validate local job requirements
    if (category === 'local' && (!address || !address.trim())) {
      return res.status(400).json({ 
        success: false, 
        message: 'Address is required for local jobs' 
      });
    }
    
    // Validate quick hire requirements
    if (quickHire === true) {
      if (!quickHirePrice || parseFloat(quickHirePrice) <= 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Quick hire price must be a positive number' 
        });
      }
      if (!contactPhone || !contactPhone.trim()) {
        return res.status(400).json({ 
          success: false, 
          message: 'Contact phone is required for quick hire jobs' 
        });
      }
    }

    if (title) job.title = title;
    if (description) job.description = description;
    if (category) {
      job.category = category.toLowerCase();
      // Auto-set isLocal based on category
      job.isLocal = category === 'local';
    }
    if (subcategory) job.subcategory = subcategory;
    if (uploadedImages.length) job.images = uploadedImages.slice(0, 5);
    if (currency) job.currency = currency;
    if (address) job.address = address;
    if (contactPhone !== undefined) job.contactPhone = contactPhone;
    if (isUrgent !== undefined) job.isUrgent = isUrgent;
    if (quickHire !== undefined) job.quickHire = quickHire;
    if (quickHirePrice !== undefined) job.quickHirePrice = quickHirePrice ? parseFloat(quickHirePrice) : null;
    
    if (country || state || city) {
      job.location = {
        country: country || job.location.country,
        state: state || job.location.state,
        city: city || job.location.city,
        coordinates: job.location.coordinates
      };
    }
    if (deadline !== undefined) job.deadline = deadline;
    if (estimatedDuration) job.estimatedDuration = estimatedDuration;
    if (skills) job.skills = Array.isArray(skills) ? skills : [skills];
    if (experienceLevel) job.experienceLevel = experienceLevel;
    if (req.body.coordinates || (req.body.latitude && req.body.longitude)) {
      job.location.coordinates = Array.isArray(req.body.coordinates)
        ? req.body.coordinates
        : [parseFloat(req.body.longitude), parseFloat(req.body.latitude)];
    }

    await job.save();

    res.json({ 
      success: true, 
      statusCode: 200, 
      message: 'Job updated successfully', 
      data: job 
    });
  } catch (err) {
    console.error('Update job error:', err);
    
    // Handle Mongoose validation errors
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors)
        .map(e => e.message)
        .join('; ');
      return res.status(400).json({ 
        success: false, 
        message: `Validation failed: ${messages}` 
      });
    }
    
    res.status(400).json({ 
      success: false, 
      message: err.message || 'Failed to update job' 
    });
  }
};

// ===== DELETE JOB =====
exports.deleteJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (job.clientId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (['in_progress', 'delivered', 'completed', 'disputed'].includes(job.status)) {
      return res.status(400).json({ success: false, message: 'Cannot delete active or completed job' });
    }

    await Job.findByIdAndDelete(req.params.id);
    res.json({ success: true, statusCode: 200, message: 'Job deleted' });
  } catch (err) {
    console.error('Delete job error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete job' });
  }
};

// ===== APPLY FOR JOB =====
exports.applyToJob = async (req, res) => {
  try {
    const rawBody = req.body || {};
    const message = rawBody.message || rawBody.coverLetter || rawBody.proposal || rawBody.proposalText || '';
    const offerPrice = rawBody.offerPrice || rawBody.proposedRate || rawBody.proposedPrice || rawBody.bidAmount;
    const { jobId } = req.params;
    const userId = req.user._id.toString();
    const cleanMessage = String(message || '').trim();

    if (req.user.userType !== 'freelancer') {
      return res.status(403).json({ success: false, message: 'Only freelancers can apply to jobs' });
    }

    if (containsBlockedCommunication(cleanMessage)) {
      return res.status(400).json({ success: false, message: 'Please keep communication inside the platform' });
    }

    const job = await Job.findById(jobId);
    if (!job || job.status !== 'open') {
      return res.status(400).json({ success: false, message: 'Job not available for application' });
    }

    if (job.clientId.toString() === userId) {
      return res.status(403).json({ success: false, message: 'Job creator cannot apply to their own job' });
    }

    const existingProposal = await Proposal.findOne({ jobId, freelancerId: userId });
    if (existingProposal) {
      return res.status(400).json({ success: false, message: 'You have already applied for this job' });
    }

    const proposedRate = Number(offerPrice || job.budget || 1);
    const timelineInDays = Number(rawBody.timelineInDays || rawBody.deliveryDays || 7);
    const fallbackMessage = `I am interested in "${job.title}" and available to discuss the work inside SkillAfrik.`;
    const coverLetter = cleanMessage || fallbackMessage;

    const proposal = await Proposal.create({
      jobId,
      freelancerId: userId,
      clientId: job.clientId,
      coverLetter,
      proposedRate: Number.isFinite(proposedRate) && proposedRate > 0 ? proposedRate : 1,
      timelineInDays: Number.isFinite(timelineInDays) && timelineInDays > 0 ? timelineInDays : 7,
      status: 'pending'
    });

    const freelancer = await User.findById(userId)
      .select('firstName lastName avatar rating ratingCount reviewCount verified isPremium isTopUser trustScore skills title');
    const applicationRecord = buildApplicationRecord(freelancer || userId, proposal, coverLetter);
    const updatedJob = await Job.findOneAndUpdate(
      {
        _id: jobId,
        status: 'open',
        applications: { $not: { $elemMatch: { freelancerId: req.user._id } } },
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
      return res.status(400).json({ success: false, message: 'You have already applied for this job' });
    }

    const savedApplication = updatedJob.applications[updatedJob.applications.length - 1];
    const applicantCount = updatedJob.applications.length;
    const applicationEvent = {
      jobId: updatedJob._id,
      jobTitle: updatedJob.title,
      applicationId: savedApplication?._id,
      proposalId: proposal._id,
      freelancerId: userId,
      applicantCount,
      proposal: proposal.coverLetter,
      price: proposal.proposedRate,
      bidAmount: proposal.proposedRate,
      timelineInDays: proposal.timelineInDays,
      deliveryDays: proposal.timelineInDays,
      status: 'pending',
      appliedAt: savedApplication?.appliedAt || proposal.createdAt,
      viewedByClient: false,
    };

    emitApplicationEvents(req, updatedJob, proposal, req.user, applicationEvent);

    res.status(201).json({
      success: true,
      statusCode: 201,
      message: 'Application submitted',
      data: {
        proposal,
        application: applicationEvent,
        applicantCount
      }
    });
  } catch (err) {
    console.error('Apply to job error:', err);
    res.status(500).json({ success: false, message: 'Failed to apply for job' });
  }
};

// ===== GET USER APPLICATIONS =====
exports.getMyApplications = async (req, res) => {
  try {
    const status = req.query.status ? normalizeStatus(req.query.status) : undefined;
    const query = { freelancerId: req.user._id };
    if (status) query.status = status;

    const proposals = await Proposal.find(query)
      .populate('jobId', 'title budget status category subcategory')
      .sort({ createdAt: -1 });

    res.json({ success: true, statusCode: 200, message: 'Applications retrieved', data: proposals });
  } catch (err) {
    console.error('Get my applications error:', err);
    res.status(500).json({ success: false, message: 'Failed to get applications' });
  }
};

const getDeliveryFilesPayload = (req) => {
  const bodyFiles = parseMaybeJson(req.body.deliveryFiles);
  const files = [];
  if (Array.isArray(bodyFiles)) {
    files.push(...bodyFiles.filter(Boolean));
  } else if (typeof bodyFiles === 'string' && bodyFiles.trim()) {
    files.push(bodyFiles.trim());
  }
  if (Array.isArray(req.files?.deliveryFiles)) {
    req.files.deliveryFiles.forEach((file) => {
      files.push(`data:${file.mimetype};base64,${file.buffer.toString('base64')}`);
    });
  }
  return files;
};

const emitWorkSubmitted = (req, job, freelancer) => {
  const io = req.app?.get?.('io');
  if (!io) return;

  const payload = {
    jobId: job._id,
    jobTitle: job.title,
    status: job.status,
    workStatus: 'submitted',
    workStatusLabel: 'Submitted',
    submittedAt: job.submittedAt,
    freelancerId: freelancer._id || freelancer.id,
  };

  io.to(`user:${job.clientId}`).emit('work_submitted', payload);
  io.to(`user:${job.freelancerId}`).emit('work_submitted', payload);
};

// ===== SUBMIT DELIVERY =====
exports.submitDelivery = async (req, res) => {
  try {
    const { deliveryText } = req.body;
    const deliveryFiles = getDeliveryFilesPayload(req);
    const job = await Job.findById(req.params.id);

    if (req.user.userType !== 'freelancer') {
      return res.status(403).json({ success: false, message: 'Only freelancers can submit work' });
    }

    if (!job || job.freelancerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (job.status === 'delivered') {
      return res.json({
        success: true,
        statusCode: 200,
        message: 'Work already submitted',
        data: enrichJobWithWorkStatus(job),
      });
    }

    if (job.status !== 'in_progress') {
      return res.status(400).json({ success: false, message: 'Work can only be submitted when the job is in progress' });
    }

    if (!job.escrowId || job.escrowStatus !== 'funded') {
      return res.status(400).json({ success: false, message: 'Escrow must be funded before submitting work' });
    }

    if (!String(deliveryText || '').trim() && deliveryFiles.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide a submission note or upload deliverables' });
    }

    const mergedFiles = [...(Array.isArray(job.deliveryFiles) ? job.deliveryFiles : []), ...deliveryFiles];
    job.status = 'delivered';
    job.deliveryText = String(deliveryText || '').trim() || job.deliveryText;
    job.deliveryFiles = mergedFiles;
    job.submittedAt = new Date();
    await job.save();

    const freelancer = await User.findById(req.user._id).select('firstName lastName');
    await notificationService.notifyWorkSubmitted(job, freelancer || req.user).catch((notificationError) => {
      console.error('Work submitted notification failed:', notificationError);
    });
    emitWorkSubmitted(req, job, freelancer || req.user);

    res.json({
      success: true,
      statusCode: 200,
      message: 'Work submitted — client notified',
      data: enrichJobWithWorkStatus(job),
    });
  } catch (err) {
    console.error('Submit delivery error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit delivery' });
  }
};

// ===== REVIEW JOB (delegates to Review collection) =====
exports.reviewJob = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const reviewerId = req.user._id.toString();

    const job = await Job.findById(id);
    if (!job || job.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Job is not completed' });
    }

    const jobClientId = job.clientId?.toString();
    const jobFreelancerId = job.freelancerId?.toString();
    let revieweeId;
    let reviewType;

    if (reviewerId === jobClientId) {
      revieweeId = jobFreelancerId;
      reviewType = 'client_to_freelancer';
    } else if (reviewerId === jobFreelancerId) {
      revieweeId = jobClientId;
      reviewType = 'freelancer_to_client';
    } else {
      return res.status(403).json({ success: false, message: 'Unauthorized to review this job' });
    }

    if (!revieweeId) {
      return res.status(400).json({ success: false, message: 'Job has no counterpart to review' });
    }

    const Review = require('../models/Review');
    const existing = await Review.findOne({ jobId: id, reviewerId });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You have already reviewed this job' });
    }

    const { review, stats } = await createReviewRecord({
      jobId: id,
      reviewerId,
      revieweeId,
      rating,
      comment,
      reviewType,
    });

    const jobUpdate = reviewerId === jobClientId
      ? { clientReview: { rating: review.rating, comment: review.comment, createdAt: review.createdAt } }
      : { freelancerReview: { rating: review.rating, comment: review.comment, createdAt: review.createdAt } };
    const updatedJob = await Job.findByIdAndUpdate(id, { $set: jobUpdate }, { new: true });

    const io = req.app?.get?.('io');
    if (io) {
      io.to(`user:${revieweeId}`).emit('profile_updated', { userId: revieweeId, ...stats });
    }

    res.json({
      success: true,
      statusCode: 200,
      message: 'Review submitted',
      data: { job: updatedJob, review, reviewee: stats },
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(400).json({ success: false, message: 'You have already reviewed this job' });
    }
    console.error('Review job error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to submit review' });
  }
};

// ===== GET DASHBOARD SUMMARY =====
exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user._id;

    const posted = await Job.countDocuments({ clientId: userId });
    const active = await Job.countDocuments({ clientId: userId, status: { $in: ['open', 'in_progress'] } });
    const completed = await Job.countDocuments({ clientId: userId, status: 'completed' });
    const applications = await Proposal.countDocuments({ freelancerId: userId });
    const inProgress = await Job.countDocuments({ freelancerId: userId, status: 'in_progress' });
    const myCompleted = await Job.countDocuments({ freelancerId: userId, status: 'completed' });

    res.json({
      success: true,
      statusCode: 200,
      message: 'Dashboard summary retrieved',
      data: {
        posted,
        active,
        completed,
        applications,
        inProgress,
        myCompleted
      }
    });
  } catch (err) {
    console.error('Get dashboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
};

// ===== GET JOBS BY STATUS =====
exports.getJobsByStatus = async (req, res) => {
  try {
    const status = normalizeStatus(req.params.status);
    const jobs = await Job.find({ status })
      .populate('createdBy', 'firstName lastName avatar rating')
      .populate('freelancerId', 'firstName lastName avatar')
      .sort({ createdAt: -1 });

    res.json({ success: true, statusCode: 200, message: 'Jobs retrieved', data: jobs });
  } catch (err) {
    console.error('Get jobs by status error:', err);
    res.status(500).json({ success: false, message: 'Failed to get jobs' });
  }
};

// ===== ACCEPT PROPOSAL OR DIRECT HIRE =====
exports.hireFreelancer = async (req, res) => {
  try {
    const { freelancerId } = req.body;
    const jobId = req.params.jobId || req.params.id;
    const userId = req.user._id.toString();

    if (req.user.userType !== 'client') {
      return res.status(403).json({
        success: false,
        message: 'Only clients can hire freelancers'
      });
    }
    
    // ===== VALIDATION BLOCK =====
    if (!freelancerId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Freelancer ID is required' 
      });
    }

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ 
        success: false, 
        message: 'Job not found' 
      });
    }
    
    if (job.clientId.toString() !== userId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized - only job creator can hire' 
      });
    }

    if (job.status !== 'open') {
      return res.status(400).json({ 
        success: false, 
        message: 'Job is not open for hiring' 
      });
    }
    
    // ===== CRITICAL VALIDATION: assigned_to cannot equal posted_by =====
    if (freelancerId.toString() === userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot hire yourself - assigned freelancer cannot be the job creator' 
      });
    }
    
    // Verify freelancer exists
    const freelancer = await User.findById(freelancerId);
    if (!freelancer) {
      return res.status(404).json({ 
        success: false, 
        message: 'Freelancer not found' 
      });
    }

    if (freelancer.userType !== 'freelancer') {
      return res.status(400).json({
        success: false,
        message: 'Selected user is not a freelancer'
      });
    }

    const hasApplication = isJobApplicant(job, freelancerId)
      || await Proposal.exists({ jobId, freelancerId });
    if (!hasApplication) {
      return res.status(400).json({
        success: false,
        message: 'Selected freelancer has not applied to this job',
      });
    }

    const escrow = await Escrow.create({
      jobId,
      clientId: req.user._id,
      freelancerId,
      amount: job.budget,
      status: 'PENDING',
      autoReleaseDateAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    applyHireToJob(job, freelancerId, req.user._id);
    job.escrowId = escrow._id;
    job.escrowStatus = 'pending';
    job.escrowAmount = job.budget;
    job.escrowAutoReleaseDate = escrow.autoReleaseDateAt;
    await job.save();
    invalidateSummaryCache(job.clientId);

    try {
      const marketplaceRoutes = require('../routes/marketplaceRoutes');
      if (typeof marketplaceRoutes.clearResponseCache === 'function') {
        marketplaceRoutes.clearResponseCache();
      }
    } catch {
      // Marketplace cache clear is best-effort.
    }

    await Proposal.updateMany(
      { jobId, freelancerId },
      { status: 'accepted', acceptedAt: new Date() }
    );
    const rejectedProposals = await Proposal.find({ jobId, freelancerId: { $ne: freelancerId } }).select('freelancerId');
    await Proposal.updateMany(
      { jobId, freelancerId: { $ne: freelancerId } },
      {
        status: 'rejected',
        rejectedAt: new Date(),
        rejectionReason: 'Not selected',
      }
    );

    try {
      await notificationService.notifyJobAssigned(job, freelancer, false);
      await notificationService.notifyClientFreelancerHired(job, freelancer);
      await Promise.all(rejectedProposals.map((proposal) => (
        notificationService.notifyApplicantNotSelected(job, proposal.freelancerId)
          .catch((notificationError) => {
            console.error('Not selected notification failed:', notificationError);
          })
      )));
    } catch (notificationError) {
      console.error('Job assignment notification failed:', notificationError);
    }

    const io = req.app?.get?.('io');
    if (io) {
      io.to(`user:${job.clientId}`).emit('job_hired', {
        jobId: job._id,
        freelancerId,
        status: job.status,
        hiredAt: job.hiredAt,
      });
      io.emit('applications:updated', { jobId: job._id });
    }

    res.json({ 
      success: true, 
      statusCode: 200, 
      message: 'Freelancer hired successfully and escrow created', 
      data: {
        job,
        escrow,
        hireStatus: 'hired',
        assignmentStatus: 'assigned',
        hiredFreelancerId: freelancerId,
      },
    });
  } catch (err) {
    console.error('Hire freelancer error:', err);
    res.status(400).json({ success: false, message: 'Failed to hire freelancer' });
  }
};

// ===== ANTI-SCAM: MANUAL JOB REVIEW =====
exports.reviewFlaggedJob = async (req, res) => {
  try {
    const jobId = req.params.jobId || req.params.id;
    const { action, notes } = req.body;
    
    // Validate admin/moderator role
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only admins can review flagged jobs' 
      });
    }
    
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Action must be "approve" or "reject"' 
      });
    }

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ 
        success: false, 
        message: 'Job not found' 
      });
    }

    // Only review jobs that have been flagged
    if (job.scam_status === 'safe') {
      return res.status(400).json({ 
        success: false, 
        message: 'This job is not flagged for review' 
      });
    }

    if (action === 'approve') {
      // Approve the job - clear scam flags
      job.scam_status = 'safe';
      job.ai_scam_score = 0;
      job.scam_reasons = [];
      job.manual_verification = false;
      job.scam_reviewed_at = new Date();
      job.scam_reviewed_by = req.user._id;
    } else if (action === 'reject') {
      // Reject the job - block it permanently
      job.scam_status = 'blocked';
      job.manual_verification = true;
      job.scam_reviewed_at = new Date();
      job.scam_reviewed_by = req.user._id;
    }

    await job.save();

    res.json({
      success: true,
      statusCode: 200,
      message: `Job ${action === 'approve' ? 'approved' : 'blocked'} by moderator`,
      data: {
        jobId: job._id,
        scam_status: job.scam_status,
        scam_score: job.ai_scam_score,
        manual_verification: job.manual_verification,
        reviewed_at: job.scam_reviewed_at
      }
    });
  } catch (err) {
    console.error('Review flagged job error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to review flagged job' 
    });
  }
};

// ===== GET FLAGGED JOBS FOR ADMIN REVIEW =====
exports.getFlaggedJobs = async (req, res) => {
  try {
    // Validate admin role
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only admins can view flagged jobs' 
      });
    }

    const { status = 'suspicious', sortBy = 'scam_score' } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const query = { scam_status: status };
    
    // If status is 'suspicious', only get jobs not yet reviewed
    if (status === 'suspicious') {
      query.manual_verification = true;
    }

    const sortOptions = {};
    if (sortBy === 'scam_score') {
      sortOptions.ai_scam_score = -1; // Highest score first
    } else if (sortBy === 'newest') {
      sortOptions.createdAt = -1;
    }

    const flaggedJobs = await Job.find(query)
      .select('title description ai_scam_score scam_status scam_reasons createdAt createdBy')
      .populate('createdBy', 'name email rating trustScore')
      .sort(sortOptions)
      .skip(skip)
      .limit(limit);

    const total = await Job.countDocuments(query);

    res.json({
      success: true,
      statusCode: 200,
      message: 'Flagged jobs retrieved',
      data: flaggedJobs,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit
      }
    });
  } catch (err) {
    console.error('Get flagged jobs error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to retrieve flagged jobs' 
    });
  }
};

// ===== GET JOB APPLICATIONS =====
exports.getJobApplications = async (req, res) => {
  try {
    let job = await Job.findById(req.params.jobId);
    if (!job || !jobOwnedByUser(job, req.user._id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    await syncApplicationsFromProposals(job);
    job = await Job.findById(req.params.jobId)
      .populate('applications.freelancerId', 'firstName lastName avatar rating ratingCount reviewCount verified isPremium isTopUser trustScore skills title');

    let markedRead = false;
    job.applications.forEach((application) => {
      if (!application.viewedByClient) {
        application.viewedByClient = true;
        markedRead = true;
      }
    });
    if (markedRead) {
      await job.save();
      invalidateSummaryCache(job.clientId);
    }

    const proposals = await Proposal.find({ jobId: req.params.jobId })
      .populate('freelancerId', 'firstName lastName avatar rating ratingCount reviewCount verified isPremium isTopUser trustScore skills title')
      .select('_id freelancerId coverLetter proposedRate timelineInDays status createdAt');
    const proposalByFreelancer = new Map(
      proposals.map((proposal) => [proposal.freelancerId?._id?.toString() || proposal.freelancerId.toString(), proposal])
    );

    const seenFreelancers = new Set();
    const applications = [];

    for (const application of job.applications) {
      const applicant = application.freelancerId;
      const freelancerId = applicant?._id?.toString() || application.freelancerId?.toString();
      if (!freelancerId || seenFreelancers.has(freelancerId)) continue;
      seenFreelancers.add(freelancerId);
      const proposal = proposalByFreelancer.get(freelancerId);
      const resolvedApplicant = applicant || proposal?.freelancerId;
      applications.push(mapApplicationForClient(application, proposal, resolvedApplicant));
    }

    for (const proposal of proposals) {
      const freelancerId = proposal.freelancerId?._id?.toString() || proposal.freelancerId?.toString();
      if (!freelancerId || seenFreelancers.has(freelancerId)) continue;
      seenFreelancers.add(freelancerId);
      const stubApplication = {
        _id: proposal._id,
        freelancerId: proposal.freelancerId?._id || proposal.freelancerId,
        status: proposal.status,
        viewedByClient: true,
        appliedAt: proposal.createdAt,
      };
      applications.push(mapApplicationForClient(stubApplication, proposal, proposal.freelancerId));
    }

    applications.sort((a, b) => new Date(b.appliedAt || 0) - new Date(a.appliedAt || 0));

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      statusCode: 200,
      message: 'Applications retrieved',
      data: applications,
      meta: {
        applicantCount: applications.length,
        filled: Boolean(job.freelancerId) || applications.some((item) => item.status === 'accepted'),
        hired: Boolean(job.hiredAt || job.freelancerId),
        assigned: Boolean(job.freelancerId),
        hireStatus: job.hiredAt || job.freelancerId ? 'hired' : null,
        assignmentStatus: job.freelancerId ? 'assigned' : null,
        hiredFreelancerId: job.freelancerId,
        escrowId: job.escrowId,
        escrowStatus: job.escrowStatus,
        escrowAmount: job.escrowAmount || job.budget,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Get applications error:', err);
    res.status(500).json({ success: false, message: 'Failed to get applications' });
  }
};

// ===== GET USER'S POSTED JOBS =====
exports.getUserJobs = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, status } = req.query;

    const query = { clientId: userId };
    if (status) {
      query.status = normalizeStatus(status);
    }

    const jobs = await Job.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('clientId', 'firstName lastName avatar')
      .lean();

    const total = await Job.countDocuments(query);
    const enrichedJobs = jobs.map((job) => {
      const applications = Array.isArray(job.applications) ? job.applications : [];
      const fallbackApplicantCount = Array.isArray(job.proposals) ? job.proposals.length : 0;
      const applicantCount = Math.max(applications.length, fallbackApplicantCount);
      const unreadApplications = applications.filter((application) => !application?.viewedByClient).length;
      const latestApplicants = [...applications]
        .sort((a, b) => new Date(b.appliedAt || 0) - new Date(a.appliedAt || 0))
        .slice(0, 3)
        .map((application) => ({
          applicationId: application._id,
          freelancerId: application.freelancerId,
          freelancerName: application.freelancerName || null,
          freelancerAvatar: application.freelancerAvatar || null,
          freelancerRating: application.freelancerRating || 0,
          freelancerTrustScore: application.freelancerTrustScore || 50,
          price: application.offerPrice || application.bidAmount || 0,
          timelineInDays: application.timelineInDays || application.deliveryDays || null,
          appliedAt: application.appliedAt,
          status: application.status || 'pending',
        }));

      return {
        ...job,
        applicantCount,
        applicationsCount: applicantCount,
        unreadApplications,
        latestApplicants,
      };
    });

    res.json({
      success: true,
      statusCode: 200,
      message: 'User jobs retrieved',
      data: enrichedJobs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Get user jobs error:', err);
    res.status(500).json({ success: false, message: 'Failed to get user jobs' });
  }
};

exports.getRecentJobs = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const jobs = await Job.find({ status: 'open' })
      .populate('createdBy', 'firstName lastName avatar rating reviewCount')
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({
      success: true,
      statusCode: 200,
      message: 'Recent jobs retrieved',
      data: jobs
    });
  } catch (err) {
    console.error('Get recent jobs error:', err);
    res.status(500).json({ success: false, message: 'Failed to get recent jobs' });
  }
};

exports.getFreelancerJobs = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const jobs = await Job.find({ freelancerId: req.user._id })
      .populate('createdBy', 'firstName lastName avatar rating reviewCount')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Job.countDocuments({ freelancerId: req.user._id });

    res.json({
      success: true,
      statusCode: 200,
      message: 'Freelancer jobs retrieved',
      data: jobs,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Get freelancer jobs error:', err);
    res.status(500).json({ success: false, message: 'Failed to get freelancer jobs' });
  }
};

exports.getAppliedJobs = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const jobs = await Job.find({
      applications: { $elemMatch: { freelancerId: req.user._id } }
    })
      .populate('createdBy', 'firstName lastName avatar rating reviewCount')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Job.countDocuments({
      applications: { $elemMatch: { freelancerId: req.user._id } }
    });

    res.json({
      success: true,
      statusCode: 200,
      message: 'Applied jobs retrieved',
      data: jobs,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Get applied jobs error:', err);
    res.status(500).json({ success: false, message: 'Failed to get applied jobs' });
  }
};

exports.acceptJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user._id.toString();
    const job = await Job.findById(jobId);

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (!job.freelancerId || job.freelancerId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'disputed') {
      return res.status(400).json({ success: false, message: 'Job cannot be accepted at this stage' });
    }

    job.status = 'in_progress';
    job.applications = job.applications.map((application) => {
      if (application.freelancerId?.toString() === userId) {
        return { ...application.toObject(), status: 'accepted' };
      }
      return application;
    });

    await job.save();

    res.json({ success: true, statusCode: 200, message: 'Job accepted', data: job });
  } catch (err) {
    console.error('Accept job error:', err);
    res.status(500).json({ success: false, message: 'Failed to accept job' });
  }
};

exports.getNearbyJobs = async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const limit = parseInt(req.query.limit, 10) || 20;

    const filters = buildJobFilters(req.query);
    filters.status = 'open';

    let jobs = await Job.find(filters)
      .populate('createdBy', 'firstName lastName avatar rating reviewCount');

    if (!isNaN(lat) && !isNaN(lng)) {
      jobs = jobs
        .map((job) => {
          const [jobLng, jobLat] = job.location.coordinates || [0, 0];
          const toRadians = (deg) => (deg * Math.PI) / 180;
          const r = 6371;
          const dLat = toRadians(lat - jobLat);
          const dLng = toRadians(lng - jobLng);
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRadians(jobLat)) * Math.cos(toRadians(lat)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distance = r * c;
          return { job, distance };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map((entry) => ({ ...entry.job.toObject(), distance: entry.distance }));
    } else {
      jobs = jobs.slice(0, limit);
    }

    res.json({ success: true, statusCode: 200, message: 'Nearby jobs retrieved', data: jobs });
  } catch (err) {
    console.error('Get nearby jobs error:', err);
    res.status(500).json({ success: false, message: 'Failed to get nearby jobs' });
  }
};

module.exports = exports;
