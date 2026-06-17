const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  return res.json({
    success: true,
    message: 'Agent route is available'
  });
});

module.exports = router;
