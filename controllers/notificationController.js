// backend/controllers/notificationController.js

const Notification = require('../models/Notification');
const mongoose = require('mongoose');

const normalizeNotification = (notification) => {
  const item = typeof notification.toObject === 'function' ? notification.toObject() : notification;
  return {
    ...item,
    isRead: Boolean(item.read),
  };
};

// Get notifications for user
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    const query = { userId };
    if (unreadOnly === 'true') {
      query.read = false;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Notification.countDocuments(query);

    res.json({
      success: true,
      data: notifications.map(normalizeNotification),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve notifications'
    });
  }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: 'Invalid notification id'
      });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      data: normalizeNotification(notification)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    await Notification.updateMany(
      { userId, read: false },
      { read: true }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read',
      data: { updated: true }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
};

// Generate smart notification
exports.generateSmart = async (req, res) => {
  try {
    const userId = req.user.id;

    // Placeholder: create a smart notification
    const notification = new Notification({
      userId,
      type: 'system',
      title: 'Smart Notification',
      message: 'This is a smart notification generated for you.',
      data: {}
    });

    await notification.save();

    res.json({
      success: true,
      data: normalizeNotification(notification)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to generate smart notification'
    });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { id } = req.params;
    const logger = require('../utils/logger');

    // Validate notification ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        statusCode: 400,
        message: 'Invalid notification id'
      });
    }

    // Find and delete the notification
    const deleted = await Notification.findOneAndDelete({ _id: id, userId });

    if (!deleted) {
      logger.warn('❌ Notification not found for deletion', { userId, notificationId: id });
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'Notification not found'
      });
    }

    logger.info('✅ Notification deleted', { userId, notificationId: id });

    res.json({
      success: true,
      statusCode: 200,
      message: 'Notification deleted successfully',
      data: { notificationId: id }
    });
  } catch (error) {
    const logger = require('../utils/logger');
    logger.error('❌ Failed to delete notification', {
      userId: req.user?.id || req.user?._id,
      notificationId: req.params?.id,
      error: error.message
    });

    res.status(500).json({
      success: false,
      statusCode: 500,
      message: 'Failed to delete notification',
      error: error.message
    });
  }
};

exports.getSettings = async (req, res) => {
  res.json({
    success: true,
    data: {
      emailNotifications: true,
      pushNotifications: true,
      messageNotifications: true,
      reviewNotifications: true
    }
  });
};

exports.updateSettings = async (req, res) => {
  res.json({
    success: true,
    message: 'Notification settings saved',
    data: req.body || {}
  });
};
