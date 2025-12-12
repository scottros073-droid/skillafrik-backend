const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Example withdrawal route (you can expand this later)
router.post('/', async (req, res) => {
  try {
    const { userId, amount } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ message: 'User ID and amount are required' });
    }

    // Deduct from user's available balance
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.wallet.available < amount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    user.wallet.available -= amount;
    user.wallet.pending += amount;
    await user.save();

    // You can later connect this to Paystack transfer API
    res.json({ message: 'Withdrawal request submitted', success: true });
  } catch (err) {
    console.error('withdrawal error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
