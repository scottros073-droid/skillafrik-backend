const monetizationService = require('../services/monetizationService');

const boostJob = async (req, res) => {
  try {
    const userId = req.user.id;
    const jobId = req.body.jobId || req.params.jobId;

    const result = await monetizationService.boostJob(userId, jobId);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Failed to boost job' });
  }
};

const featureJob = async (req, res) => {
  try {
    const userId = req.user.id;
    const jobId = req.body.jobId || req.params.jobId;

    const result = await monetizationService.featureJob(userId, jobId);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Failed to feature job' });
  }
};

module.exports = {
  boostJob,
  featureJob
};
