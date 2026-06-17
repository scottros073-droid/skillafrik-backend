// backend/controllers/adController.js
const Ad = require("../models/Ad");

/**
 * Get all approved ads
 */
exports.getAds = async (req, res) => {
  try {
    const ads = await Ad.find({ status: 'approved' })
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: ads.map(ad => ({
        id: ad._id,
        title: ad.title,
        description: ad.description,
        imageUrl: ad.imageUrl,
        link: ad.link,
        category: ad.category,
        views: ad.views,
        clicks: ad.clicks,
        createdAt: ad.createdAt
      }))
    });
  } catch (error) {
    console.error("Error getting ads:", error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve ads'
    });
  }
};

/**
 * Create ad request
 */
exports.createAd = async (req, res) => {
  try {
    const { title, description, imageUrl, link, category } = req.body;
    const userId = req.user.id;

    const ad = await Ad.create({
      title,
      description,
      imageUrl,
      link,
      category: category || 'general',
      createdBy: userId,
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      data: {
        id: ad._id,
        title: ad.title,
        description: ad.description,
        imageUrl: ad.imageUrl,
        link: ad.link,
        category: ad.category,
        status: ad.status,
        createdAt: ad.createdAt
      }
    });
  } catch (error) {
    console.error("Error creating ad:", error);
    res.status(500).json({ success: false, message: "Failed to create ad" });
  }
};

/**
 * Track ad view
 */
exports.trackView = async (req, res) => {
  try {
    const { id } = req.params;

    await Ad.findByIdAndUpdate(id, { $inc: { views: 1 } });

    res.json({
      success: true,
      data: { message: "View tracked" }
    });
  } catch (error) {
    console.error("Error tracking view:", error);
    res.status(500).json({ success: false, message: "Failed to track view" });
  }
};

/**
 * Track ad click
 */
exports.trackClick = async (req, res) => {
  try {
    const { id } = req.params;

    await Ad.findByIdAndUpdate(id, { $inc: { clicks: 1 } });

    res.json({
      success: true,
      data: { message: "Click tracked" }
    });
  } catch (error) {
    console.error("Error tracking click:", error);
    res.status(500).json({ success: false, message: "Failed to track click" });
  }
};

/**
 * Get all ads for admin
 */
exports.getAdminAds = async (req, res) => {
  try {
    const ads = await Ad.find()
      .populate('createdBy', 'firstName lastName email')
      .populate('approvedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: ads.map(ad => ({
        id: ad._id,
        title: ad.title,
        description: ad.description,
        imageUrl: ad.imageUrl,
        link: ad.link,
        category: ad.category,
        status: ad.status,
        views: ad.views,
        clicks: ad.clicks,
        createdBy: {
          id: ad.createdBy._id,
          name: `${ad.createdBy.firstName} ${ad.createdBy.lastName}`,
          email: ad.createdBy.email
        },
        approvedBy: ad.approvedBy ? {
          id: ad.approvedBy._id,
          name: `${ad.approvedBy.firstName} ${ad.approvedBy.lastName}`
        } : null,
        createdAt: ad.createdAt,
        approvedAt: ad.approvedAt
      }))
    });
  } catch (error) {
    console.error("Error getting admin ads:", error);
    res.status(500).json({ success: false, message: "Failed to get ads" });
  }
};

/**
 * Approve ad
 */
exports.approveAd = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const ad = await Ad.findByIdAndUpdate(
      id,
      {
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: userId
      },
      { new: true }
    );

    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found" });
    }

    res.json({
      success: true,
      data: {
        id: ad._id,
        title: ad.title,
        status: ad.status,
        approvedAt: ad.approvedAt
      }
    });
  } catch (error) {
    console.error("Error approving ad:", error);
    res.status(500).json({ success: false, message: "Failed to approve ad" });
  }
};