const Review = require('../models/Review');
const { refreshUserRatingAndTrust } = require('./userRatings');

const createReviewRecord = async ({
  jobId,
  reviewerId,
  revieweeId,
  rating,
  comment,
  reviewType,
}) => {
  const normalizedRating = Math.min(5, Math.max(1, Math.round(Number(rating))));

  const review = await Review.create({
    jobId,
    reviewerId,
    revieweeId,
    rating: normalizedRating,
    comment: String(comment || '').trim(),
    reviewType,
    status: 'approved',
    approvedAt: new Date(),
  });

  const stats = await refreshUserRatingAndTrust(revieweeId);
  return { review, stats };
};

module.exports = {
  createReviewRecord,
};
