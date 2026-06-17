// backend/routes/adRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');
const {
  getAds,
  createAd,
  trackView,
  trackClick,
  getAdminAds,
  approveAd
} = require('../controllers/adController');

// Get all approved ads
router.get('/', getAds);

// Create ad request
router.post('/', authMiddleware, createAd);

// Track ad view
router.post('/:id/view', trackView);

// Track ad click
router.post('/:id/click', trackClick);

// Admin routes
router.get('/admin/ads', authMiddleware, adminMiddleware, getAdminAds);
router.put('/admin/ads/:id/approve', authMiddleware, adminMiddleware, approveAd);

module.exports = router;
