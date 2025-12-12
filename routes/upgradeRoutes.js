const express = require('express');
const router = express.Router();
const Upgrade = require('../models/Upgrade');

// Create an upgrade request
router.post('/', async (req, res) => {
  const { userId, plan, amount } = req.body;
  const upgrade = new Upgrade({ userId, plan, amount });
  await upgrade.save();
  res.json({ message: 'Upgrade successful', upgrade });
});

// Get all upgrades
router.get('/', async (req, res) => {
  const upgrades = await Upgrade.find().sort({ date: -1 });
  res.json(upgrades);
});

module.exports = router;
