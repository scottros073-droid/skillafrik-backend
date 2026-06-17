// backend/routes/categoriesRoutes.js

const express = require('express');
const categoriesController = require('../controllers/categoriesController');

const router = express.Router();

// Get all categories (public)
router.get('/', categoriesController.getCategories);

module.exports = router;