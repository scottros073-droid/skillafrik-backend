// backend/routes/userRoutes.js

const express = require('express');
const multer = require('multer');
const userController = require('../controllers/userController');
const { authMiddleware } = require('../middleware/authMiddleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype || '')) {
      return cb(new Error('Avatar must be an image file'), false);
    }
    return cb(null, true);
  }
});

const avatarUpload = (req, res, next) => {
  upload.single('avatar')(req, res, (error) => {
    if (error) return res.status(400).json({ success: false, message: error.message });
    return next();
  });
};

const userRouter = express.Router();
userRouter.get('/profile', authMiddleware, userController.getUserProfile);
userRouter.put('/profile', authMiddleware, avatarUpload, userController.updateProfile);
userRouter.put('/bank-details', authMiddleware, userController.updateBankDetails);
userRouter.delete('/account', authMiddleware, userController.deleteAccount);

const profileRouter = express.Router();
profileRouter.get('/', authMiddleware, userController.getUserProfile);
profileRouter.put('/', authMiddleware, avatarUpload, userController.updateProfile);
profileRouter.delete('/', authMiddleware, userController.deleteAccount);

const freelancerRouter = express.Router();
freelancerRouter.get('/', userController.getFreelancers);
freelancerRouter.get('/freelancers', userController.getFreelancers);
freelancerRouter.get('/skills', userController.getSkills);
freelancerRouter.get('/freelancers/:id', userController.getFreelancer);
freelancerRouter.get('/freelancer/:id', userController.getFreelancer);
freelancerRouter.get('/:id', userController.getFreelancer);

const publicProfileRouter = express.Router();
publicProfileRouter.get('/:userId', userController.getPublicProfile);

const usersRouter = express.Router();
usersRouter.get('/freelancers', userController.getFreelancers);
usersRouter.get('/:id', userController.getPublicProfile);

module.exports = {
  userRouter,
  profileRouter,
  freelancerRouter,
  publicProfileRouter,
  usersRouter
};
