const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const referralController = require('../controllers/referralController');

router.get('/me', authMiddleware, referralController.getMyReferral);
router.post('/invite', authMiddleware, referralController.inviteFriend);

module.exports = router;
