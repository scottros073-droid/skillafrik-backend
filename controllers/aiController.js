const aiService = require('../services/aiService');
const User = require('../models/User');
const { hasPremiumAIAccess, incrementAiUsage } = require('../middleware/aiUsageMiddleware');

const getUser = (req) => User.findById(req.user?._id || req.user?.id).select(
  'aiUsageCount aiLimit isPremium premium premiumExpiryDate subscription subscriptionPlan subscriptionExpiresAt'
);

const sendUnavailable = (res, message = 'AI feature is temporarily unavailable.') => res.status(503).json({
  success: false,
  message,
  data: {
    unavailable: true
  }
});

const getCredits = async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const canUseAI = hasPremiumAIAccess(user);
    return res.json({
      success: true,
      message: 'AI access status retrieved successfully',
      data: {
        allowed: canUseAI,
        canUseAI,
        upgradeRequired: !canUseAI,
        usageCount: user.aiUsageCount || 0,
        remaining: canUseAI ? null : 0,
        subscriptionPlan: user.subscriptionPlan,
        subscriptionExpiresAt: user.subscriptionExpiresAt || user.premiumExpiryDate
      }
    });
  } catch (error) {
    console.error('AI status error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve AI status.' });
  }
};

const generateProposal = async (req, res) => {
  try {
    const { jobTitle, jobDescription, freelancerBio } = req.body || {};
    if (!jobTitle || !jobDescription) {
      return res.status(400).json({ success: false, message: 'Job title and description are required.' });
    }

    const proposal = await aiService.generateProposal(jobTitle, jobDescription, freelancerBio);
    await incrementAiUsage(req, res);

    return res.json({
      success: true,
      message: 'Proposal generated successfully',
      data: { proposal }
    });
  } catch (error) {
    console.error('AI proposal error:', error);
    return sendUnavailable(res);
  }
};

const generateCV = async (req, res) => {
  try {
    const cvData = req.body || {};
    const normalized = {
      fullName: cvData.fullName || cvData.name || '',
      email: cvData.email || '',
      phone: cvData.phone || '',
      summary: cvData.summary || cvData.title || '',
      experience: Array.isArray(cvData.experience)
        ? cvData.experience
        : String(cvData.experience || '').trim()
          ? [{ position: 'Experience', company: '', duration: '', description: cvData.experience }]
          : [],
      education: Array.isArray(cvData.education)
        ? cvData.education
        : String(cvData.education || '').trim()
          ? [{ degree: cvData.education, school: '', year: '' }]
          : [],
      skills: Array.isArray(cvData.skills)
        ? cvData.skills
        : String(cvData.skills || '').split(',').map((skill) => skill.trim()).filter(Boolean)
    };

    if (!normalized.fullName || !normalized.skills.length) {
      return res.status(400).json({ success: false, message: 'Name and skills are required.' });
    }

    const cvText = await aiService.generateCV(normalized);
    await incrementAiUsage(req, res);

    return res.json({
      success: true,
      message: 'CV generated successfully',
      data: {
        cvText,
        coverLetter: `Dear Hiring Manager,\n\nPlease find my CV below. I would be glad to discuss how my skills can support your project.\n\nBest regards,\n${normalized.fullName}`
      }
    });
  } catch (error) {
    console.error('AI CV error:', error);
    return sendUnavailable(res);
  }
};

const generateDesign = async (req, res) => {
  try {
    const { type = 'logo', description, businessName } = req.body || {};
    if (!description) {
      return res.status(400).json({ success: false, message: 'Logo description is required.' });
    }

    const logo = await aiService.generateLogo({
      prompt: description,
      style: type,
      businessName: businessName || 'SkillAfrik Logo'
    });
    await incrementAiUsage(req, res);

    return res.json({
      success: true,
      message: 'Logo generated successfully',
      data: { imageUrl: logo.imageUrl }
    });
  } catch (error) {
    console.error('AI logo error:', error);
    return sendUnavailable(res);
  }
};

const assistant = async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required.' });
    }

    const reply = await aiService.assistantReply(message);
    await incrementAiUsage(req, res);

    return res.json({
      success: true,
      message: 'AI assistant replied',
      data: { reply }
    });
  } catch (error) {
    console.error('AI assistant error:', error);
    return sendUnavailable(res);
  }
};

const getUsageStats = getCredits;
const checkCredits = getCredits;

module.exports = {
  getCredits,
  getUsageStats,
  checkCredits,
  generateProposal,
  generateCV,
  generateDesign,
  assistant
};
