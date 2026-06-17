// backend/routes/jobRoutes.js

const express = require('express');
const multer = require('multer');
const jobController = require('../controllers/jobController');
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');
const { validate, jobSchema } = require('../middleware/validation');
const monetizationController = require('../controllers/monetizationController');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype || '')) {
      return cb(new Error('Job image must be an image file'), false);
    }
    return cb(null, true);
  }
});

const deliveryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

const optionalJobImage = (req, res, next) => {
  imageUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'images', maxCount: 5 }
  ])(req, res, (error) => {
    if (error) return res.status(400).json({ success: false, message: error.message });
    return next();
  });
};

const optionalDeliveryFiles = (req, res, next) => {
  deliveryUpload.fields([{ name: 'deliveryFiles', maxCount: 10 }])(req, res, (error) => {
    if (error) return res.status(400).json({ success: false, message: error.message });
    return next();
  });
};

// ===== PUBLIC ROUTES =====
router.get('/', jobController.getAllJobs);
router.get('/nearby', jobController.getNearbyJobs);
router.get('/recommendations', authMiddleware, jobController.getJobRecommendations);

// ===== SPECIFIC GET ROUTES (before generic /:id) =====
router.get('/status/:status', authMiddleware, jobController.getJobsByStatus);
router.get('/my-applications', authMiddleware, jobController.getMyApplications);
router.get('/dashboard', authMiddleware, jobController.getDashboard);
router.get('/recent', jobController.getRecentJobs);
router.get('/freelancer', authMiddleware, jobController.getFreelancerJobs);
router.get('/applied', authMiddleware, jobController.getAppliedJobs);
router.get('/applications/my', authMiddleware, jobController.getMyApplications);
router.get('/posted', authMiddleware, jobController.getUserJobs);
router.get('/my-jobs', authMiddleware, jobController.getUserJobs);
router.get('/user/my-jobs', authMiddleware, jobController.getUserJobs);

// ===== POST ROUTES (Create & Workflow) =====
router.post('/', authMiddleware, requireRole('client', 'freelancer'), optionalJobImage, jobController.createJob);
router.post('/:jobId/apply', authMiddleware, requireRole('freelancer'), rateLimit({ windowMs: 60000, max: 30 }), jobController.applyToJob);
router.post('/:jobId/accept', authMiddleware, jobController.acceptJob);
router.post('/:jobId/hire', authMiddleware, requireRole('client'), jobController.hireFreelancer);
router.post('/:id/review', authMiddleware, jobController.reviewJob);
router.post('/:id/submit', authMiddleware, requireRole('freelancer'), optionalDeliveryFiles, jobController.submitDelivery);

// ===== MONETIZATION ROUTES =====
router.post('/:jobId/boost', authMiddleware, (req, res) => {
  req.body.jobId = req.params.jobId;
  monetizationController.boostJob(req, res);
});
router.post('/:jobId/feature', authMiddleware, monetizationController.featureJob);

// ===== JOB APPLICATIONS =====
router.get('/:jobId/applications', authMiddleware, jobController.getJobApplications);

// ===== GENERIC ID ROUTES (after specific routes) =====
router.get('/:id', jobController.getJobById);
router.put('/:id', authMiddleware, optionalJobImage, jobController.updateJob);
router.delete('/:id', authMiddleware, jobController.deleteJob);

module.exports = router;
