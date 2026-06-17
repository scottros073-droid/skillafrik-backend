const express = require('express');
const { authMiddleware } = require('../middleware/authMiddleware');
const { aiLimiter } = require('../middleware/security');
const { aiUsageMiddleware, requireAIFeature } = require('../middleware/aiUsageMiddleware');
const aiController = require('../controllers/aiController');

const router = express.Router();

router.get('/credits', authMiddleware, aiController.getCredits);
router.get('/credits/:type', authMiddleware, aiController.getCredits);
router.get('/usage', authMiddleware, aiController.getUsageStats);
router.get('/usage/check/:type', authMiddleware, aiController.checkCredits);

router.post('/generate/proposal', authMiddleware, aiLimiter, requireAIFeature('proposal'), aiUsageMiddleware, aiController.generateProposal);
router.post('/generate/design', authMiddleware, aiLimiter, requireAIFeature('design'), aiUsageMiddleware, aiController.generateDesign);
router.post('/generate/cv', authMiddleware, aiLimiter, requireAIFeature('cv'), aiUsageMiddleware, aiController.generateCV);
router.post('/cv/generate/preview', authMiddleware, aiLimiter, requireAIFeature('cv'), aiUsageMiddleware, aiController.generateCV);
router.post('/cv/generate/cv', authMiddleware, aiLimiter, requireAIFeature('cv'), aiUsageMiddleware, aiController.generateCV);
router.post('/assistant', authMiddleware, aiLimiter, requireAIFeature('assistant'), aiUsageMiddleware, aiController.assistant);
router.post('/assistant/chat', authMiddleware, aiLimiter, requireAIFeature('assistant'), aiUsageMiddleware, aiController.assistant);

module.exports = router;
