// backend/routes/portfolioRoutes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const {
  createPortfolio,
  getMyPortfolios,
  getPortfolio,
  updatePortfolio,
  deletePortfolio,
  addProject,
  removeProject
} = require('../controllers/portfolioController');

// Create portfolio
router.post('/', authMiddleware, createPortfolio);

// Get user's portfolios
router.get('/my-portfolios', authMiddleware, getMyPortfolios);

// Get portfolio by ID
router.get('/:id', authMiddleware, getPortfolio);

// Update portfolio
router.put('/:id', authMiddleware, updatePortfolio);

// Delete portfolio
router.delete('/:id', authMiddleware, deletePortfolio);

// Add project to portfolio
router.post('/:id/projects', authMiddleware, addProject);

// Remove project from portfolio
router.delete('/:id/projects/:projectId', authMiddleware, removeProject);

module.exports = router;
