// backend/controllers/gamificationController.js
const Gamification = require("../models/Gamification");

const recalculateLevels = (profile) => {
  while (profile.currentLevelXP >= profile.nextLevelXP) {
    profile.currentLevelXP -= profile.nextLevelXP;
    profile.level += 1;
    profile.nextLevelXP = Math.round(profile.nextLevelXP * 1.25);
    profile.badges.push(`level_${profile.level}`);
  }
};

/**
 * Record activity and award XP
 */
exports.recordActivity = async (req, res) => {
  try {
    const { xp = 10, activityType } = req.body;
    const userId = req.user.id;

    const profile = await Gamification.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { upsert: true, new: true }
    );

    profile.totalXP += xp;
    profile.currentLevelXP += xp;
    profile.lastActivityDate = new Date();
    profile.currentStreak = profile.currentStreak + 1;
    profile.longestStreak = Math.max(profile.longestStreak, profile.currentStreak);

    if (activityType) {
      profile.activitiesCompleted[activityType] = (profile.activitiesCompleted[activityType] || 0) + 1;
    }

    recalculateLevels(profile);
    await profile.save();

    res.json({
      level: profile.level,
      totalXP: profile.totalXP,
      currentLevelXP: profile.currentLevelXP,
      nextLevelXP: profile.nextLevelXP,
      badges: profile.badges,
      currentStreak: profile.currentStreak,
      longestStreak: profile.longestStreak
    });
  } catch (error) {
    console.error("Error recording activity:", error);
    res.status(500).json({ success: false, message: "Failed to record activity" });
  }
};

/**
 * Get leaderboard
 */
exports.getLeaderboard = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const leaderboard = await Gamification.find({})
      .populate('userId', 'firstName lastName avatar')
      .sort({ totalXP: -1 })
      .limit(limit);

    res.json({
      leaderboard: leaderboard.map(entry => ({
        user: {
          id: entry.userId._id,
          name: `${entry.userId.firstName} ${entry.userId.lastName}`,
          avatar: entry.userId.avatar
        },
        level: entry.level,
        totalXP: entry.totalXP,
        badges: entry.badges
      }))
    });
  } catch (error) {
    console.error("Error getting leaderboard:", error);
    res.status(500).json({ success: false, message: "Failed to get leaderboard" });
  }
};

/**
 * Get weekly leaderboard
 */
exports.getWeeklyLeaderboard = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const leaderboard = await Gamification.find({
      lastActivityDate: { $gte: weekAgo }
    })
      .populate('userId', 'firstName lastName avatar')
      .sort({ totalXP: -1 })
      .limit(limit);

    res.json({
      leaderboard: leaderboard.map(entry => ({
        user: {
          id: entry.userId._id,
          name: `${entry.userId.firstName} ${entry.userId.lastName}`,
          avatar: entry.userId.avatar
        },
        level: entry.level,
        totalXP: entry.totalXP,
        badges: entry.badges
      }))
    });
  } catch (error) {
    console.error("Error getting weekly leaderboard:", error);
    res.status(500).json({ success: false, message: "Failed to get weekly leaderboard" });
  }
};

/**
 * Get skills leaderboard
 */
exports.getSkillsLeaderboard = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const leaderboard = await Gamification.find({})
      .populate('userId', 'firstName lastName avatar')
      .sort({ 'activitiesCompleted.job_completed': -1 })
      .limit(limit);

    res.json({
      leaderboard: leaderboard.map(entry => ({
        user: {
          id: entry.userId._id,
          name: `${entry.userId.firstName} ${entry.userId.lastName}`,
          avatar: entry.userId.avatar
        },
        jobsCompleted: entry.activitiesCompleted.job_completed || 0,
        badges: entry.badges
      }))
    });
  } catch (error) {
    console.error("Error getting skills leaderboard:", error);
    res.status(500).json({ success: false, message: "Failed to get skills leaderboard" });
  }
};

/**
 * Get user's skills
 */
exports.getUserSkills = async (req, res) => {
  try {
    const { userId } = req.params;

    const profile = await Gamification.findOne({ userId });

    if (!profile) {
      return res.json({
        userId,
        activitiesCompleted: {},
        badges: []
      });
    }

    res.json({
      userId: profile.userId,
      activitiesCompleted: profile.activitiesCompleted,
      badges: profile.badges
    });
  } catch (error) {
    console.error("Error getting user skills:", error);
    res.status(500).json({ success: false, message: "Failed to get user skills" });
  }
};

/**
 * Get streak info
 */
exports.getStreak = async (req, res) => {
  try {
    const userId = req.user.id;

    const profile = await Gamification.findOne({ userId });

    if (!profile) {
      return res.json({
        currentStreak: 0,
        longestStreak: 0,
        lastActivityDate: null
      });
    }

    res.json({
      currentStreak: profile.currentStreak,
      longestStreak: profile.longestStreak,
      lastActivityDate: profile.lastActivityDate
    });
  } catch (error) {
    console.error("Error getting streak:", error);
    res.status(500).json({ success: false, message: "Failed to get streak" });
  }
};

/**
 * Get user's streak
 */
exports.getUserStreak = async (req, res) => {
  try {
    const { userId } = req.params;

    const profile = await Gamification.findOne({ userId });

    if (!profile) {
      return res.json({
        userId,
        currentStreak: 0,
        longestStreak: 0,
        lastActivityDate: null
      });
    }

    res.json({
      userId: profile.userId,
      currentStreak: profile.currentStreak,
      longestStreak: profile.longestStreak,
      lastActivityDate: profile.lastActivityDate
    });
  } catch (error) {
    console.error("Error getting user streak:", error);
    res.status(500).json({ success: false, message: "Failed to get user streak" });
  }
};