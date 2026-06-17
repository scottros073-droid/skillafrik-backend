// backend/routes/reviewRoutes.js

const express = require('express');
const reviewController = require('../controllers/reviewController');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// Create review (protected)
router.post('/', authMiddleware, reviewController.createReview);
router.get('/job/:jobId/status', authMiddleware, reviewController.getJobReviewStatus);

// Public routes
router.get('/user/:userId', reviewController.getUserReviews);
router.post('/refresh/:userId', authMiddleware, reviewController.refreshUserRatings);
router.get('/:userId/rating', reviewController.getAverageRating);
router.get('/:userId/average', reviewController.getAverageRating);
router.get('/freelancer/:id', reviewController.getFreelancerReviews);
router.get('/:userId', reviewController.getUserReviews);

module.exports = router;
