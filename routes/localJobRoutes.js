// filepath: backend/routes/localJobRoutes.js
const express = require('express');
const router = express.Router();
const localJobController = require('../controllers/localJobController');
const { authMiddleware } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(authMiddleware);

// Create local job
router.post('/', localJobController.createLocalJob);

// Get nearby jobs
router.get('/nearby', localJobController.getNearbyJobs);

// Search local jobs
router.get('/search', localJobController.searchLocalJobs);

// Get my local jobs
router.get('/my-jobs', localJobController.getMyLocalJobs);

// Get local job by ID
router.get('/:jobId', localJobController.getLocalJob);

// Quick hire (1-click accept)
router.post('/:jobId/quick-hire', localJobController.quickHire);

// Boost job
router.post('/:jobId/boost', localJobController.boostJob);

// Update local job
router.put('/:jobId', localJobController.updateLocalJob);

// Delete local job
router.delete('/:jobId', localJobController.deleteLocalJob);

module.exports = router;
