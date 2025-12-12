const express = require('express');
const router = express.Router();
const { withdraw } = require('../controllers/walletController');
const authMiddleware = require('../middleware/auth');

router.post('/withdraw', authMiddleware, withdraw);

module.exports = router;
