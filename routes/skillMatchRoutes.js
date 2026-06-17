// backend/routes/skillMatchRoutes.js

const express = require('express');
const skillMatchController = require('../controllers/skillMatchController');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// Get skill matches (protected)
router.get('/', authMiddleware, skillMatchController.getSkillMatch);

module.exports = router;