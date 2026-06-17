// backend/routes/gamificationRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const {
  recordActivity,
  getLeaderboard,
  getWeeklyLeaderboard,
  getSkillsLeaderboard,
  getUserSkills,
  getStreak,
  getUserStreak
} = require('../controllers/gamificationController');

// Record activity
router.post('/activity', authMiddleware, recordActivity);

// Get leaderboard
router.get('/leaderboard', getLeaderboard);

// Get weekly leaderboard
router.get('/leaderboard/weekly', getWeeklyLeaderboard);

// Get skills leaderboard
router.get('/skills', getSkillsLeaderboard);

// Get user's skills
router.get('/skills/:userId', getUserSkills);

// Get current user's streak
router.get('/streak', authMiddleware, getStreak);

// Get user's streak
router.get('/streak/:userId', getUserStreak);

module.exports = router;
