/**
 * =====================================================
 * REFRESH TOKEN CLEANUP UTILITY
 * =====================================================
 * Removes stale, expired, and revoked refresh tokens
 * Prevents MongoDB bloat and improves auth performance
 */

const mongoose = require('mongoose');
const RefreshToken = require('../models/RefreshToken');
const logger = require('./logger');

/**
 * Clean up stale and expired refresh tokens
 * Run on server startup and periodically (e.g., daily)
 */
const cleanupStaleTokens = async () => {
  try {
    // ===== DELETE EXPIRED TOKENS =====
    const expiredResult = await RefreshToken.deleteMany({
      expiresAt: { $lt: new Date() }
    });

    logger.info('Cleaned up expired refresh tokens', {
      deletedCount: expiredResult.deletedCount
    });

    // ===== DELETE REVOKED TOKENS =====
    // Only delete revoked tokens older than 7 days to reduce frequency
    const revokedResult = await RefreshToken.deleteMany({
      revoked: true,
      revokedAt: { 
        $exists: true,
        $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days old
      }
    });

    logger.info('Cleaned up revoked refresh tokens', {
      deletedCount: revokedResult.deletedCount
    });

    // ===== DELETE INVALID USERID TOKENS (NEVER STORE admin-user-id) =====
    const invalidUserIdResult = await RefreshToken.deleteMany({
      userId: 'admin-user-id'
    });

    if (invalidUserIdResult.deletedCount > 0) {
      logger.warn('Removed admin-user-id refresh tokens from database', {
        deletedCount: invalidUserIdResult.deletedCount
      });
    }

    // Skip invalid ObjectId check to avoid full collection scan
    // This check is performance-intensive and rarely needed
    logger.info('Skipping invalid ObjectId check for performance');

    logger.info('Refresh token cleanup completed successfully');
    return true;
  } catch (error) {
    logger.error('Refresh token cleanup failed', {
      error: error.message,
      stack: error.stack
    });
    // Don't throw - let server start even if cleanup fails
    return false;
  }
};

/**
 * Revoke all user tokens when user logs out or account is suspended
 */
const revokeUserTokens = async (userId) => {
  try {
    const result = await RefreshToken.updateMany(
      {
        userId: userId,
        revoked: false
      },
      {
        revoked: true,
        revokedAt: new Date()
      }
    );

    logger.info('Revoked all user refresh tokens', {
      userId,
      modifiedCount: result.modifiedCount
    });

    return result.modifiedCount;
  } catch (error) {
    logger.error('Failed to revoke user tokens', {
      userId,
      error: error.message
    });
    throw error;
  }
};

/**
 * Schedule cleanup to run on server startup
 */
const scheduleCleanup = async () => {
  try {
    // Run cleanup on startup in background (don't await)
    cleanupStaleTokens().catch((err) => {
      logger.error('Background token cleanup failed', { error: err.message });
    });

    // Run cleanup daily at 2 AM UTC
    const scheduleNextCleanup = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(2, 0, 0, 0);

      if (tomorrow <= now) {
        tomorrow.setDate(tomorrow.getDate() + 1);
      }

      const msUntilCleanup = tomorrow - now;

      setTimeout(async () => {
        await cleanupStaleTokens();
        scheduleNextCleanup(); // Reschedule for next day
      }, msUntilCleanup);

      logger.info('Refresh token cleanup scheduled', {
        nextCleanup: tomorrow.toISOString()
      });
    };

    scheduleNextCleanup();
  } catch (error) {
    logger.error('Failed to schedule token cleanup', {
      error: error.message
    });
  }
};

module.exports = {
  cleanupStaleTokens,
  revokeUserTokens,
  scheduleCleanup
};
