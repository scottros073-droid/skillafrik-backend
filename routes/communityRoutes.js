// backend/routes/communityRoutes.js

const express = require('express');
const communityController = require('../controllers/communityController');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// Public routes
router.get('/', communityController.getCommunity);

// Protected routes
router.post('/', authMiddleware, communityController.createPost);
router.post('/vote', authMiddleware, communityController.voteCommunity);
router.post('/:postId/reply', authMiddleware, communityController.replyToPost);

module.exports = router;
