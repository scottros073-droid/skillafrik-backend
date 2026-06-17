// backend/routes/notificationRoutes.js

const express = require('express');
const notificationController = require('../controllers/notificationController');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Get notifications
router.get('/', notificationController.getNotifications);

// Mark as read
router.put('/:id/read', notificationController.markAsRead);
router.post('/:id/read', notificationController.markAsRead);

// Mark all as read
router.put('/read-all', notificationController.markAllAsRead);
router.post('/read-all', notificationController.markAllAsRead);

// Generate smart notification
router.post('/generate-smart', notificationController.generateSmart);

// Notification settings
router.get('/settings', notificationController.getSettings);
router.put('/settings', notificationController.updateSettings);

// Delete notification - must come after other routes to avoid route conflicts
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;
