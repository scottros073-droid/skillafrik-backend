const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const axios = require('axios');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// Withdraw worker funds
router.post('/withdraw', auth, async (req, res) => {
  try {
    const { amount, payoutMethodId } = req.body;
    const user = req.user;

    // Check balance
    if (!user.wallet || user.wallet.available < amount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // Simulate Paystack transfer
    const transfer = await axios.post(
      'https://api.paystack.co/transfer',
      {
        source: 'balance',
        amount: amount * 100,
        recipient: payoutMethodId,
        reason: 'Wallet withdrawal',
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Update wallet
    user.wallet.available -= amount;
    if (!user.wallet.transactions) user.wallet.transactions = [];
    user.wallet.transactions.push({
      type: 'withdraw',
      amount,
      date: new Date(),
      gatewayRef: transfer.data.data.transfer_code,
      status: 'COMPLETED',
    });

    await user.save();

    res.json({
      message: `Withdrawal of ${amount} completed`,
      gatewayRef: transfer.data.data.transfer_code,
      wallet: user.wallet,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
