const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middleware/authMiddleware');
const { validate, proposalSchema } = require('../middleware/validation');
const proposalController = require('../controllers/proposalController');
const Proposal = require('../models/Proposal');

// ======================================================
// CONTROLLER-BASED ROUTES (PRIMARY)
// ======================================================

// Create proposal
router.post('/', authMiddleware, proposalController.createProposal);

// Get proposals for a job (client)
router.get('/job/:jobId', authMiddleware, proposalController.getProposalsForJob);

// Get user's proposals (freelancer)
router.get('/', authMiddleware, proposalController.getUserProposals);

// Accept proposal (controller version)
router.post('/:id/accept', authMiddleware, proposalController.acceptProposal);

// Reject proposal (controller version)
router.post('/:id/reject', authMiddleware, proposalController.rejectProposal);


// ======================================================
// FALLBACK ROUTES (SAFE INLINE HANDLERS - NO DELETE)
// ======================================================
// These act as backup if controller is incomplete

// Accept proposal (fallback)
router.post('/:id/accept-direct', authMiddleware, async (req, res) => {
  try {
    const proposal = await Proposal.findById(req.params.id);

    if (!proposal) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'Proposal not found'
      });
    }

    proposal.status = 'accepted';
    proposal.acceptedAt = new Date();
    await proposal.save();

    res.json({
      success: true,
      statusCode: 200,
      message: 'Proposal accepted',
      data: proposal
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      statusCode: 400,
      message: 'Failed to accept proposal',
      error: err.message
    });
  }
});

// Reject proposal (fallback)
router.post('/:id/reject-direct', authMiddleware, async (req, res) => {
  try {
    const proposal = await Proposal.findById(req.params.id);

    if (!proposal) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'Proposal not found'
      });
    }

    proposal.status = 'rejected';
    proposal.rejectedAt = new Date();
    await proposal.save();

    res.json({
      success: true,
      statusCode: 200,
      message: 'Proposal rejected',
      data: proposal
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      statusCode: 400,
      message: 'Failed to reject proposal',
      error: err.message
    });
  }
});


// ======================================================
// EXPORT
// ======================================================
module.exports = router;
