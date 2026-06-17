// backend/routes/ordersRoutes.js

const express = require('express');
const ordersController = require('../controllers/ordersController');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// Get user orders (protected)
router.get('/', authMiddleware, ordersController.getOrders);
router.post('/', authMiddleware, ordersController.createOrder);

// Get order by ID (protected)
router.get('/:id', authMiddleware, ordersController.getOrderById);

module.exports = router;
