const mongoose = require('mongoose');
const Review = require('../models/Review');
const Job = require('../models/Job');
const User = require('../models/User');
const { refreshUserRatingAndTrust, formatReview } = require('../utils/userRatings');
const { createReviewRecord } = require('../utils/reviewHelpers');

const getReviewerId = (req) => String(req.user._id || req.user.id);

const resolveReviewContext = (job, reviewerId) => {
  const jobClientId = job.clientId?.toString();
  const jobFreelancerId = job.freelancerId?.toString();

  if (reviewerId === jobClientId) {
    return {
      revieweeId: jobFreelancerId,
      reviewType: 'client_to_freelancer',
    };
  }

  if (reviewerId === jobFreelancerId) {
    return {
      revieweeId: jobClientId,
      reviewType: 'freelancer_to_client',
    };
  }

  return null;
};

exports.createReview = async (req, res) => {
  try {
    const { jobId, revieweeId, rating, comment, reviewType } = req.body;
    const reviewerId = getReviewerId(req);

    if (!jobId || !revieweeId || !rating || !String(comment || '').trim() || !reviewType) {
      return res.status(400).json({
        success: false,
        message: 'Job, recipient, rating, comment, and review type are required',
      });
    }

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (job.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Reviews can only be submitted after the job is completed',
      });
    }

    const context = resolveReviewContext(job, reviewerId);
    if (!context) {
      return res.status(403).json({ success: false, message: 'Not authorized to review this job' });
    }

    if (revieweeId.toString() !== context.revieweeId) {
      return res.status(400).json({
        success: false,
        message: 'Review recipient does not match your job counterpart',
      });
    }

    if (reviewType !== context.reviewType) {
      return res.status(400).json({
        success: false,
        message: 'Review type does not match your role on this job',
      });
    }

    const existingReview = await Review.findOne({ jobId, reviewerId });
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this job',
        data: formatReview(existingReview),
      });
    }

    const { review, stats } = await createReviewRecord({
      jobId,
      reviewerId,
      revieweeId,
      rating,
      comment,
      reviewType,
    });

    const jobUpdate = reviewerId === job.clientId?.toString()
      ? { clientReview: { rating: review.rating, comment: review.comment, createdAt: review.createdAt } }
      : { freelancerReview: { rating: review.rating, comment: review.comment, createdAt: review.createdAt } };
    await Job.findByIdAndUpdate(jobId, { $set: jobUpdate });

    const io = req.app?.get?.('io');
    if (io) {
      io.to(`user:${revieweeId}`).emit('profile_updated', {
        userId: revieweeId,
        ...stats,
      });
      io.to(`user:${reviewerId}`).emit('profile_updated', { userId: reviewerId });
    }

    res.status(201).json({
      success: true,
      message: 'Review submitted',
      data: {
        review: formatReview(review),
        reviewee: stats,
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this job',
      });
    }
    console.error('API ERROR:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};

exports.getJobReviewStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    const reviewerId = getReviewerId(req);

    const job = await Job.findById(jobId)
      .populate('clientId', 'firstName lastName avatar rating trustScore verified isPremium isTopUser')
      .populate('freelancerId', 'firstName lastName avatar rating trustScore verified isPremium isTopUser');

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const context = resolveReviewContext(job, reviewerId);
    const existingReview = context
      ? await Review.findOne({ jobId, reviewerId })
      : null;

    res.json({
      success: true,
      data: {
        jobId: job._id,
        jobStatus: job.status,
        canReview: Boolean(context && job.status === 'completed' && !existingReview),
        alreadyReviewed: Boolean(existingReview),
        revieweeId: context?.revieweeId || null,
        reviewType: context?.reviewType || null,
        existingReview: existingReview ? formatReview(existingReview) : null,
        client: job.clientId,
        freelancer: job.freelancerId,
      },
    });
  } catch (error) {
    console.error('API ERROR:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.getUserReviews = async (req, res) => {
  try {
    const { userId } = req.params;

    const reviews = await Review.find({ revieweeId: userId, status: 'approved' })
      .populate('reviewerId', 'firstName lastName avatar verified isPremium isTopUser')
      .populate('jobId', 'title')
      .sort({ createdAt: -1 });

    const user = await User.findById(userId).select(
      'rating ratingCount reviewCount trustScore verified isPremium isTopUser'
    );

    res.status(200).json({
      success: true,
      data: reviews.map(formatReview),
      meta: user ? {
        rating: user.rating,
        ratingCount: user.ratingCount,
        reviewCount: user.reviewCount,
        trustScore: user.trustScore,
        verified: user.verified,
        isPremium: user.isPremium,
        isTopUser: user.isTopUser,
      } : null,
    });
  } catch (error) {
    console.error('API ERROR:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

exports.getAverageRating = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(200).json({
        success: true,
        data: { averageRating: 0, totalReviews: 0, trustScore: 50 },
      });
    }

    const stats = await refreshUserRatingAndTrust(userId);

    res.status(200).json({
      success: true,
      data: {
        averageRating: stats.rating,
        totalReviews: stats.reviewCount,
        trustScore: stats.trustScore,
        isTopUser: stats.isTopUser,
      },
    });
  } catch (error) {
    console.error('API ERROR:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};

exports.getFreelancerReviews = async (req, res) => {
  try {
    const { id } = req.params;

    const reviews = await Review.find({
      revieweeId: id,
      reviewType: 'client_to_freelancer',
      status: 'approved',
    })
      .populate('reviewerId', 'firstName lastName avatar')
      .populate('jobId', 'title')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: reviews.map(formatReview),
    });
  } catch (error) {
    console.error('API ERROR:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
    });
  }
};

exports.refreshUserRatings = async (req, res) => {
  try {
    const { userId } = req.params;
    const stats = await refreshUserRatingAndTrust(userId);
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('API ERROR:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};
