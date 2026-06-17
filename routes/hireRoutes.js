const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const Hire = require('../models/Hire');
const Job = require('../models/Job');
const User = require('../models/User');

// Create hire posting (client posts job for freelancers to apply)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, description, category, budget, skills, deadline } = req.body;
    const clientId = req.user._id;

    const hire = await Hire.create({
      title,
      description,
      category,
      budget,
      skills: skills || [],
      deadline,
      clientId,
      status: 'open'
    });

    res.json({
      success: true,
      statusCode: 201,
      message: 'Hire posting created successfully',
      data: hire
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to create hire posting',
      error: err.message
    });
  }
});

// Get marketplace (all open hire postings)
router.get('/marketplace', async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    let query = { status: 'open' };

    if (category) query.category = category;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const hires = await Hire.find(query)
      .populate('clientId', 'name email profilePicture rating')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Hire.countDocuments(query);

    res.json({
      success: true,
      statusCode: 200,
      message: 'Marketplace retrieved',
      data: hires,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to get marketplace',
      error: err.message
    });
  }
});

// Get hires for a user (worker or client)
router.get('/hires/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    // Only allow users to view their own hires
    if (req.user._id.toString() !== userId && req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: 'Forbidden: Can only view your own hires'
      });
    }

    const hires = await Hire.find({
      $or: [{ clientId: userId }, { workerId: userId }],
    })
    .populate('clientId', 'name email profilePicture')
    .populate('workerId', 'name email profilePicture')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      statusCode: 200,
      message: 'Hires retrieved',
      data: hires
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to get hires',
      error: err.message
    });
  }
});

// Get hire details
router.get('/:id', async (req, res) => {
  try {
    const hire = await Hire.findById(req.params.id)
      .populate('clientId', 'name email profilePicture rating')
      .populate('workerId', 'name email profilePicture rating');

    if (!hire) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'Hire posting not found'
      });
    }

    res.json({
      success: true,
      statusCode: 200,
      message: 'Hire details retrieved',
      data: hire
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to get hire details',
      error: err.message
    });
  }
});

// Update hire posting (only by client)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const hire = await Hire.findById(req.params.id);

    if (!hire) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'Hire posting not found'
      });
    }

    if (hire.clientId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: 'Forbidden: Only the client can update this posting'
      });
    }

    const updates = req.body;
    Object.assign(hire, updates);
    await hire.save();

    res.json({
      success: true,
      statusCode: 200,
      message: 'Hire posting updated',
      data: hire
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to update hire posting',
      error: err.message
    });
  }
});

// Delete hire posting (only by client)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const hire = await Hire.findById(req.params.id);

    if (!hire) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'Hire posting not found'
      });
    }

    if (hire.clientId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: 'Forbidden: Only the client can delete this posting'
      });
    }

    await hire.remove();

    res.json({
      success: true,
      statusCode: 200,
      message: 'Hire posting deleted'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to delete hire posting',
      error: err.message
    });
  }
});

// Direct hire freelancer (client hires specific freelancer)
router.post('/:freelancerId', authMiddleware, async (req, res) => {
  try {
    const { freelancerId } = req.params;
    const { jobData } = req.body;
    const clientId = req.user._id;

    // Verify freelancer exists
    const freelancer = await User.findById(freelancerId);
    if (!freelancer) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'Freelancer not found'
      });
    }

    // Create hire posting with assigned freelancer
    const hire = await Hire.create({
      ...jobData,
      clientId,
      workerId: freelancerId,
      status: 'assigned'
    });

    res.json({
      success: true,
      statusCode: 201,
      message: 'Freelancer hired successfully',
      data: hire
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to hire freelancer',
      error: err.message
    });
  }
});

// Legacy endpoint for backward compatibility
router.post('/hire', authMiddleware, async (req, res) => {
  try {
    const { jobId, clientId, workerId } = req.body;

    const hire = await Hire.create({
      jobId,
      clientId,
      workerId,
      status: 'assigned'
    });

    res.json({
      success: true,
      statusCode: 201,
      message: 'Worker hired successfully',
      data: hire
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to hire worker',
      error: err.message
    });
  }
});

// Direct hire freelancer (client hires specific freelancer)
router.post('/freelancer/:freelancerId', authMiddleware, async (req, res) => {
  try {
    const { freelancerId } = req.params;
    const { jobData } = req.body;
    const clientId = req.user._id;

    // Verify freelancer exists
    const freelancer = await User.findById(freelancerId);
    if (!freelancer) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'Freelancer not found'
      });
    }

    // Create hire posting with assigned freelancer
    const hire = await Hire.create({
      ...jobData,
      clientId,
      workerId: freelancerId,
      status: 'assigned'
    });

    res.json({
      success: true,
      statusCode: 201,
      message: 'Freelancer hired successfully',
      data: hire
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to hire freelancer',
      error: err.message
    });
  }
});

// Get hires for a user (worker or client)
router.get('/hires/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    // Only allow users to view their own hires
    if (req.user._id.toString() !== userId && req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: 'Forbidden: Can only view your own hires'
      });
    }

    const hires = await Hire.find({
      $or: [{ clientId: userId }, { workerId: userId }],
    })
    .populate('clientId', 'name email profilePicture')
    .populate('workerId', 'name email profilePicture')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      statusCode: 200,
      message: 'Hires retrieved',
      data: hires
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to get hires',
      error: err.message
    });
  }
});

module.exports = router;