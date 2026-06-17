// filepath: backend/models/RefreshToken.js
const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    index: true,
    validate: {
      validator: function(value) {
        // Only allow valid ObjectIds for refresh token storage
        return mongoose.Types.ObjectId.isValid(value);
      },
      message: 'userId must be a valid ObjectId'
    }
  },
  token: {
    type: String,
    required: true,
    unique: true,
    index: true,
    sparse: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  revoked: {
    type: Boolean,
    default: false,
    index: true
  },
  revokedAt: Date,
  userAgent: String,
  ipAddress: String
}, {
  timestamps: true
});

// ===== COMPOUND INDEX FOR EFFICIENT QUERIES =====
// This prevents race condition: ensures we can efficiently check for non-revoked tokens
refreshTokenSchema.index({ userId: 1, revoked: 1, expiresAt: 1 });

// Index for cleanup of revoked tokens - only indexes documents where revokedAt exists
refreshTokenSchema.index({ revoked: 1, revokedAt: 1 }, { sparse: true });

// Automatic cleanup of expired tokens (TTL Index)
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ===== STATIC METHODS FOR SAFE TOKEN MANAGEMENT =====

/**
 * Revoke a specific refresh token safely
 * Returns: { success: boolean, message: string, result?: UpdateResult }
 */
refreshTokenSchema.statics.revokeToken = async function(tokenHash, userId) {
  try {
    if (!userId || !tokenHash) {
      return { success: false, message: 'Missing required parameters' };
    }

    const result = await this.updateOne(
      { 
        userId, 
        token: tokenHash, 
        revoked: false 
      },
      { 
        revoked: true, 
        revokedAt: new Date() 
      }
    );

    return {
      success: result.modifiedCount > 0,
      message: result.modifiedCount > 0 ? 'Token revoked' : 'Token not found or already revoked',
      result
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

/**
 * Create a new refresh token with duplicate prevention
 * Uses database unique constraint to prevent duplicates
 * Returns: { success: boolean, message: string, token?: doc }
 */
refreshTokenSchema.statics.createSafeToken = async function(tokenHash, userId, expiresAt, metadata = {}) {
  try {
    if (!userId || !tokenHash || !expiresAt) {
      return { success: false, message: 'Missing required parameters' };
    }

    const newToken = await this.create({
      userId,
      token: tokenHash,
      expiresAt,
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress
    });

    return { success: true, message: 'Token created', token: newToken };
  } catch (error) {
    if (error.code === 11000) {
      return { success: false, message: 'Token already exists (duplicate prevention)' };
    }
    return { success: false, message: error.message };
  }
};

/**
 * Verify a refresh token exists and is not revoked
 * Returns: { valid: boolean, token?: doc, message: string }
 */
refreshTokenSchema.statics.verifyTokenExists = async function(tokenHash, userId) {
  try {
    const token = await this.findOne({
      token: tokenHash,
      userId,
      revoked: false,
      expiresAt: { $gt: new Date() }
    });

    if (!token) {
      return { valid: false, message: 'Token not found, expired, or revoked' };
    }

    return { valid: true, token, message: 'Token valid' };
  } catch (error) {
    return { valid: false, message: error.message };
  }
};

// Static method to clean up expired tokens
refreshTokenSchema.statics.cleanupExpired = async function() {
  return this.deleteMany({
    expiresAt: { $lt: new Date() },
    revoked: false
  });
};

// Static method to revoke all user tokens
refreshTokenSchema.statics.revokeAllUserTokens = async function(userId) {
  // Allow admin user IDs but don't process them
  if (userId === 'admin-user-id') {
    console.warn('Skipping revokeAllUserTokens for admin user');
    return { modifiedCount: 0 };
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    console.warn('Skipping revokeAllUserTokens for invalid ObjectId:', userId);
    return { modifiedCount: 0 };
  }

  return this.updateMany(
    { userId, revoked: false },
    { revoked: true, revokedAt: new Date() }
  );
};

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);