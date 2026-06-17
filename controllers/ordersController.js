// backend/controllers/ordersController.js
const Job = require('../models/Job');
const User = require('../models/User');
const Escrow = require('../models/Escrow');

// Get user orders
exports.getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
    const query = {
      $or: [{ clientId: req.user.id }, { freelancerId: req.user.id }]
    };

    const [orders, total] = await Promise.all([
      Job.find(query)
        .select('title description status budget currency clientId freelancerId escrowId createdAt completedAt')
        .populate('clientId', 'firstName lastName avatar')
        .populate('freelancerId', 'firstName lastName avatar')
        .populate('escrowId', 'status amount fundedAt releasedAt disputed')
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      Job.countDocuments(query)
    ]);

    res.json({
      success: true,
      statusCode: 200,
      message: 'Orders retrieved',
      data: orders,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Get order by ID
exports.getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const order = await Job.findById(id)
      .select('title description status budget currency clientId freelancerId escrowId deliveryText deliveryFiles createdAt completedAt')
      .populate('clientId', 'firstName lastName avatar')
      .populate('freelancerId', 'firstName lastName avatar')
      .populate('escrowId', 'status amount fundedAt releasedAt disputed disputeReason')
      .lean();

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const canView = [order.clientId?._id?.toString(), order.freelancerId?._id?.toString()].includes(userId);
    const user = await User.findById(userId).select('userType').lean();
    if (!canView && user?.userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'You do not have access to this order' });
    }

    res.json({
      success: true,
      statusCode: 200,
      message: 'Order retrieved',
      data: order
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

exports.createOrder = async (req, res) => {
  try {
    const { serviceId, freelancerId, price } = req.body || {};
    const clientId = req.user.id;

    if (!serviceId || !freelancerId) {
      return res.status(400).json({ success: false, message: 'Service and freelancer are required' });
    }

    if (freelancerId.toString() === clientId.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot order your own service' });
    }

    const service = await Job.findById(serviceId).lean();
    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    const freelancer = await User.findById(freelancerId).select('firstName lastName userType').lean();
    if (!freelancer) {
      return res.status(404).json({ success: false, message: 'Freelancer not found' });
    }

    const workMode = service.category === 'local' && service.address ? 'local' : 'remote';
    const order = await Job.create({
      title: service.title,
      description: service.description,
      category: workMode,
      subcategory: service.subcategory || '',
      budget: Number(price || service.budget || 1),
      currency: service.currency || 'NGN',
      skills: service.skills || [],
      location: service.location || {},
      address: workMode === 'local' ? service.address || '' : '',
      isLocal: workMode === 'local',
      jobType: service.jobType || 'fixed',
      createdBy: clientId,
      clientId,
      freelancerId,
      status: 'in_progress'
    });

    const escrow = await Escrow.create({
      jobId: order._id,
      clientId,
      freelancerId,
      amount: order.budget,
      status: 'PENDING',
      autoReleaseDateAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
    order.escrowId = escrow._id;
    await order.save();

    res.status(201).json({
      success: true,
      message: 'Order created',
      data: { order, escrow }
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to create order' });
  }
};
