const express = require('express');
const router = express.Router();
const Upgrade = require('../models/Upgrade');

// Start upgrade
router.post('/', async (req, res) => {
  try {
    const upgrade = new Upgrade(req.body);
    await upgrade.save();
    res.json({ message: 'Upgrade started', upgrade });
  } catch (err) {
    res.status(500).json({ message: 'Upgrade failed', error: err.message });
  }
});

module.exports = router;
