const mongoose = require('mongoose');

const gamificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  
  // XP & Levels
  totalXP: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  currentLevelXP: { type: Number, default: 0 },
  nextLevelXP: { type: Number, default: 100 },
  
  // Streaks
  currentStreak: { type: Number, default: 0 },
  longestStreak: { type: Number, default: 0 },
  lastActivityDate: { type: Date, default: null },
  
  // Activities
  activitiesCompleted: {
    proposalsSubmitted: { type: Number, default: 0 },
    jobsCompleted: { type: Number, default: 0 },
    reviewsLeft: { type: Number, default: 0 },
    profileUpdates: { type: Number, default: 0 },
  },
  
  // Skills XP (tracks XP per category/skill)
  skillXP: [{
    skill: { type: String, required: true },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 }
  }],
  
  // Badges Earned
  badges: [{ type: String }], // e.g., 'pro_contributor', 'expert', 'fast_worker'
  
}, { timestamps: true });

gamificationSchema.index({ totalXP: -1 }); // For leaderboard

module.exports = mongoose.model('Gamification', gamificationSchema);
