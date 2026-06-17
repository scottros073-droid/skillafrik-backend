// filepath: backend/routes/authRoutes.js
const express = require('express');
const authController = require('../controllers/authController');
const userController = require('../controllers/userController');
const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');
const { authLimiter, signupLimiter, forgotPasswordLimiter, requireTrustedOrigin } = require('../middleware/security');
const { validate, loginSchema, signupSchema } = require('../middleware/validation');

const router = express.Router();

// Public routes with rate limiting
const signupHandlers = [signupLimiter, validate(signupSchema), authController.signup];
router.post('/register', ...signupHandlers);
router.post('/signup', ...signupHandlers);
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/google', authLimiter, authController.authGoogle);
router.post('/refresh', requireTrustedOrigin, authController.refreshToken);
// Lightweight probe to check whether refresh cookie exists without causing auth failures
router.get('/refresh-probe', authController.refreshProbe);
router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);
router.post('/reset-password/:token', authController.resetPassword);

// Protected routes
router.get('/me', authMiddleware, authController.getCurrentUser);
router.get('/profile', authMiddleware, userController.getUserProfile);
router.put('/profile', authMiddleware, userController.updateProfile);
router.delete('/delete-account', authMiddleware, userController.deleteAccount);
router.post('/logout', authController.logout);

// Admin routes
router.get('/users', authMiddleware, adminMiddleware, authController.getAllUsers);

module.exports = router;
