const mongoose = require('mongoose');
const Review = require('../models/Review');
const User = require('../models/User');

const computeTrustScore = (averageRating, reviewCount) => {
  if (!reviewCount) return 50;
  const avgBoost = (Number(averageRating) - 3) * 12;
  const volumeBoost = Math.min(reviewCount, 10);
  return Math.round(Math.min(100, Math.max(0, 50 + avgBoost + volumeBoost)));
};

const refreshUserRatingAndTrust = async (userId) => {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return { rating: 0, ratingCount: 0, reviewCount: 0, trustScore: 50, isTopUser: false };
  }

  const [stats] = await Review.aggregate([
    {
      $match: {
        revieweeId: new mongoose.Types.ObjectId(userId),
        status: 'approved',
      },
    },
    {
      $group: {
        _id: '$revieweeId',
        average: { $avg: '$rating' },
        count: { $sum: 1 },
      },
    },
  ]);

  const rating = stats?.average ? Number(stats.average.toFixed(2)) : 0;
  const reviewCount = stats?.count || 0;
  const trustScore = computeTrustScore(rating, reviewCount);
  const isTopUser = rating >= 4.5 && reviewCount >= 3;

  await User.findByIdAndUpdate(userId, {
    rating,
    ratingCount: reviewCount,
    reviewCount,
    trustScore,
    isTopUser,
  });

  return { rating, ratingCount, reviewCount, trustScore, isTopUser };
};

const formatReview = (review) => {
  const doc = review?.toObject ? review.toObject() : review;
  const reviewer = doc.reviewerId && typeof doc.reviewerId === 'object'
    ? doc.reviewerId
    : doc.reviewer;
  const job = doc.jobId && typeof doc.jobId === 'object' ? doc.jobId : null;

  return {
    id: doc._id,
    _id: doc._id,
    jobId: job?._id || doc.jobId,
    jobTitle: job?.title || doc.jobTitle,
    reviewerId: reviewer?._id || doc.reviewerId,
    reviewer: reviewer ? {
      id: reviewer._id,
      firstName: reviewer.firstName,
      lastName: reviewer.lastName,
      avatar: reviewer.avatar,
    } : null,
    revieweeId: doc.revieweeId,
    rating: doc.rating,
    comment: doc.comment,
    reviewType: doc.reviewType,
    status: doc.status,
    createdAt: doc.createdAt,
  };
};

module.exports = {
  computeTrustScore,
  refreshUserRatingAndTrust,
  formatReview,
};
