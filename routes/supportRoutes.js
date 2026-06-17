// backend/routes/supportRoutes.js

const express = require('express');
const supportController = require('../controllers/supportController');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// Get support tickets (protected)
router.get('/', authMiddleware, supportController.getSupportTickets);

// Create support ticket (protected)
router.post('/', authMiddleware, supportController.createSupportTicket);

// Send support message (chat-based support)
router.post('/message', authMiddleware, supportController.sendSupportMessage);

module.exports = router;