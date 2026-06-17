// backend/controllers/skillMatchController.js
const Job = require('../models/Job');
const User = require('../models/User');

// Get skill matches for user
exports.getSkillMatch = async (req, res) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId).select('skills rating totalCompletedJobs').lean();
    const userSkills = Array.isArray(user?.skills)
      ? user.skills.map((skill) => String(skill).toLowerCase())
      : [];

    const openJobs = await Job.find({ status: 'open' })
      .select('title description category subcategory skills budget currency createdAt')
      .sort({ createdAt: -1 })
      .limit(40)
      .lean();

    const matches = openJobs
      .map((job) => {
        const jobSkills = Array.isArray(job.skills) ? job.skills.map((skill) => String(skill).toLowerCase()) : [];
        const overlap = jobSkills.filter((skill) => userSkills.includes(skill));
        const score = userSkills.length && jobSkills.length
          ? Math.round((overlap.length / Math.max(jobSkills.length, 1)) * 100)
          : 0;

        return {
          job,
          score,
          reason: overlap.length
            ? `Matched on ${overlap.slice(0, 3).join(', ')}`
            : 'Recent open job you may want to review'
        };
      })
      .sort((left, right) => right.score - left.score || new Date(right.job.createdAt) - new Date(left.job.createdAt))
      .slice(0, 3);

    res.json({
      success: true,
      statusCode: 200,
      message: 'Skill matches retrieved',
      data: {
        userId,
        matches,
        usageToday: 1,
        limit: 3,
        limitReached: false,
        matchedJobs: matches.length,
        completionRate: userSkills.length ? 100 : 0,
        averageRating: user?.rating || 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};
