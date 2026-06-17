// filepath: backend/controllers/localJobController.js
const Job = require('../models/Job');
const User = require('../models/User');
const geoService = require('../services/geoService');
const JOB_TITLE_MIN_LENGTH = 5;

// ===== CREATE LOCAL JOB =====
exports.createLocalJob = async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      budget,
      skills,
      isUrgent,
      quickHire,
      quickHirePrice,
      address,
      city,
      state,
      country,
      latitude,
      longitude,
      coordinates,
      contactPhone,
      radius,
      jobType
    } = req.body;

    const cleanTitle = String(title || '').trim().replace(/\s+/g, ' ');
    const cleanDescription = String(description || '').trim().replace(/\s+/g, ' ');
    const resolvedBudget = Number(budget || quickHirePrice);

    if (!cleanTitle) {
      return res.status(400).json({ success: false, message: 'Job title is required' });
    }
    if (cleanTitle.length < JOB_TITLE_MIN_LENGTH) {
      return res.status(400).json({ success: false, message: `Title must be at least ${JOB_TITLE_MIN_LENGTH} characters` });
    }
    if (cleanTitle.length > 200) {
      return res.status(400).json({ success: false, message: 'Title cannot exceed 200 characters' });
    }
    if (!cleanDescription) {
      return res.status(400).json({ success: false, message: 'Job description is required' });
    }
    if (cleanDescription.length < 50) {
      return res.status(400).json({ success: false, message: 'Description must be at least 50 characters' });
    }
    if (!Number.isFinite(resolvedBudget) || resolvedBudget <= 0) {
      return res.status(400).json({ success: false, message: 'Budget must be greater than 0' });
    }

    const user = await User.findById(req.user.id).select('location');
    const parsedCoordinates = Array.isArray(coordinates)
      ? coordinates
      : typeof coordinates === 'string'
        ? coordinates.split(',').map((value) => Number(value.trim()))
        : null;
    const resolvedCoordinates = parsedCoordinates?.length === 2 && parsedCoordinates.every(Number.isFinite)
      ? parsedCoordinates
      : latitude && longitude
        ? [Number(longitude), Number(latitude)]
        : Array.isArray(user?.location?.coordinates) && user.location.coordinates.length === 2
          ? user.location.coordinates
          : [0, 0];
    const resolvedState = String(state || user?.location?.state || '').trim();
    const resolvedCity = String(city || user?.location?.city || '').trim();
    const resolvedAddress = String(address || user?.location?.address || [resolvedCity, resolvedState].filter(Boolean).join(', ')).trim();

    if (!resolvedState || !resolvedCity) {
      return res.status(400).json({
        success: false,
        message: 'State and city are required for local jobs'
      });
    }

    // Create job
    const job = await Job.create({
      title: cleanTitle,
      description: cleanDescription,
      category: 'local',
      subcategory: category,
      budget: resolvedBudget,
      skills: skills || [],
      createdBy: req.user.id,
      clientId: req.user.id,
      location: {
        country: country || user?.location?.country || 'Nigeria',
        state: resolvedState,
        city: resolvedCity,
        coordinates: resolvedCoordinates
      },
      isLocal: true,
      isUrgent: isUrgent || false,
      quickHire: quickHire || false,
      quickHirePrice: quickHirePrice || null,
      address: resolvedAddress,
      contactPhone: quickHire ? contactPhone : '',
      radius: radius || 10,
      jobType: jobType || 'fixed',
      status: 'open'
    });

    // If urgent, set expiration
    if (isUrgent) {
      job.urgentExpiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
      await job.save();
    }

    res.status(201).json({
      success: true,
      data: job
    });
  } catch (error) {
    console.error('Create local job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create local job'
    });
  }
};

// ===== GET NEARBY JOBS =====
exports.getNearbyJobs = async (req, res) => {
  try {
    const { latitude, longitude, radius = 10, category, skills, limit = 20 } = req.query;

    // Use user's location if not provided
    let userLocation;
    if (latitude && longitude) {
      userLocation = { latitude: parseFloat(latitude), longitude: parseFloat(longitude) };
    } else {
      const user = await User.findById(req.user.id);
      if (!user || !user.location || !user.location.coordinates) {
        return res.status(400).json({
          success: false,
          message: 'Please provide location or set it in your profile'
        });
      }
      userLocation = {
        latitude: user.location.coordinates[1],
        longitude: user.location.coordinates[0]
      };
    }

    const radiusKm = parseFloat(radius);
    const query = {
      isLocal: true,
      status: 'open',
      category: 'local'
    };

    // Filter by category if provided
    if (category) {
      query.subcategory = category;
    }

    // Filter by skills if provided
    if (skills) {
      const skillArray = skills.split(',').map(s => s.trim());
      query.skills = { $in: skillArray };
    }

    // Use aggregation for geo search with distance calculation
    const jobs = await Job.aggregate([
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: [userLocation.longitude, userLocation.latitude]
          },
          distanceField: 'distance',
          maxDistance: radiusKm * 1000,
          spherical: true,
          query: query
        }
      },
      {
        $sort: {
          isUrgent: -1,
          distance: 1,
          createdAt: -1
        }
      },
      {
        $limit: parseInt(limit)
      }
    ]);

    // Add distance in km to each job
    const jobsWithDistance = jobs.map(job => ({
      ...job,
      distance: Math.round(job.distance / 1000 * 10) / 10 // Convert to km
    }));

    res.json({
      success: true,
      data: jobsWithDistance,
      meta: {
        location: userLocation,
        radius: radiusKm,
        count: jobsWithDistance.length
      }
    });
  } catch (error) {
    console.error('Get nearby jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby jobs'
    });
  }
};

// ===== GET MY LOCAL JOBS =====
exports.getMyLocalJobs = async (req, res) => {
  try {
    const jobs = await Job.find({
      clientId: req.user.id,
      isLocal: true
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: jobs
    });
  } catch (error) {
    console.error('Get my local jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get local jobs'
    });
  }
};

// ===== QUICK HIRE (1-CLICK ACCEPT) =====
exports.quickHire = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findOne({
      _id: jobId,
      isLocal: true,
      quickHire: true,
      status: 'open'
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Quick hire job not found'
      });
    }

    // Check if user is the owner
    if (job.clientId.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot accept your own job'
      });
    }

    // Accept the job
    job.freelancerId = req.user.id;
    job.status = 'in_progress';
    job.applications.push({
      freelancerId: req.user.id,
      offerPrice: job.quickHirePrice,
      message: 'Accepted via Quick Hire',
      status: 'accepted',
      appliedAt: new Date()
    });
    await job.save();

    res.json({
      success: true,
      message: 'Job accepted successfully',
      data: job
    });
  } catch (error) {
    console.error('Quick hire error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept job'
    });
  }
};

// ===== BOOST JOB =====
exports.boostJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findOne({
      _id: jobId,
      clientId: req.user.id,
      isLocal: true
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Boost the job
    job.isBoosted = true;
    job.boostedAt = new Date();
    job.boostCount += 1;
    await job.save();

    res.json({
      success: true,
      message: 'Job boosted successfully',
      data: job
    });
  } catch (error) {
    console.error('Boost job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to boost job'
    });
  }
};

// ===== SEARCH LOCAL JOBS =====
exports.searchLocalJobs = async (req, res) => {
  try {
    const { q, category, minBudget, maxBudget, skills, sort = 'distance' } = req.query;

    const query = {
      isLocal: true,
      status: 'open'
    };

    // Text search
    if (q) {
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } }
      ];
    }

    // Category filter
    if (category) {
      query.subcategory = category;
    }

    // Budget filter
    if (minBudget || maxBudget) {
      query.budget = {};
      if (minBudget) query.budget.$gte = parseFloat(minBudget);
      if (maxBudget) query.budget.$lte = parseFloat(maxBudget);
    }

    // Skills filter
    if (skills) {
      const skillArray = skills.split(',').map(s => s.trim());
      query.skills = { $in: skillArray };
    }

    // Sort options
    let sortOption = {};
    switch (sort) {
      case 'price_low':
        sortOption = { budget: 1 };
        break;
      case 'price_high':
        sortOption = { budget: -1 };
        break;
      case 'newest':
        sortOption = { createdAt: -1 };
        break;
      case 'urgent':
        sortOption = { isUrgent: -1, createdAt: -1 };
        break;
      default:
        sortOption = { isUrgent: -1, createdAt: -1 };
    }

    const jobs = await Job.find(query)
      .sort(sortOption)
      .limit(50);

    res.json({
      success: true,
      data: jobs,
      count: jobs.length
    });
  } catch (error) {
    console.error('Search local jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search local jobs'
    });
  }
};

// ===== GET LOCAL JOB BY ID =====
exports.getLocalJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findById(jobId)
      .populate('clientId', 'firstName lastName avatar rating')
      .populate('freelancerId', 'firstName lastName avatar rating');

    if (!job || !job.isLocal) {
      return res.status(404).json({
        success: false,
        message: 'Local job not found'
      });
    }

    // Increment view count
    job.viewCount += 1;
    await job.save();

    res.json({
      success: true,
      data: job
    });
  } catch (error) {
    console.error('Get local job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job'
    });
  }
};

// ===== UPDATE LOCAL JOB =====
exports.updateLocalJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const updates = req.body;

    const job = await Job.findOne({
      _id: jobId,
      clientId: req.user.id,
      isLocal: true
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Allowed updates
    const allowedUpdates = ['title', 'description', 'budget', 'skills', 'isUrgent', 'address', 'radius'];
    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        job[key] = updates[key];
      }
    }

    await job.save();

    res.json({
      success: true,
      data: job
    });
  } catch (error) {
    console.error('Update local job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update job'
    });
  }
};

// ===== DELETE LOCAL JOB =====
exports.deleteLocalJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findOneAndDelete({
      _id: jobId,
      clientId: req.user.id,
      isLocal: true
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    res.json({
      success: true,
      message: 'Job deleted successfully'
    });
  } catch (error) {
    console.error('Delete local job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete job'
    });
  }
};
