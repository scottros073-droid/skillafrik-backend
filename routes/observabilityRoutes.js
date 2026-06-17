const express = require('express');
const { clientErrorReporter } = require('../middleware/observability');
const { clientErrorLimiter } = require('../middleware/security');

const router = express.Router();

router.post('/client-errors', clientErrorLimiter, clientErrorReporter);

module.exports = router;
