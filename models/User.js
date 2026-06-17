const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  // Basic Info
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phoneNumber: { type: String, default: null },
  password: { type: String, default: null },
  avatar: { type: String, default: null },
  
  // OAuth Integration
  googleId: { type: String, unique: true, sparse: true },
  authProvider: { type: String, enum: ['email', 'google'], default: 'email' },
  
  // Account Type & Role
  userType: { type: String, enum: ['client', 'freelancer', 'admin'], default: 'freelancer' },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  
  // Verification & Status
  verified: { type: Boolean, default: true },
  verificationToken: { type: String, default: null },
  verificationTokenExpiry: { type: Date, default: null },
  verificationDate: { type: Date, default: null },
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },
  
  // Account Status
  status: { type: String, enum: ['active', 'suspended', 'banned'], default: 'active' },
  suspensionReason: { type: String, default: null },
  suspensionDate: { type: Date, default: null },
  
  // Premium & Top User
  isPremium: { type: Boolean, default: false },
  premiumTier: { type: String, enum: ['basic', 'professional', 'expert'], default: 'basic' },
  premiumExpiryDate: { type: Date, default: null },
  isTopUser: { type: Boolean, default: false },
  topUserExpiryDate: { type: Date, default: null },
  
  // Subscription
  subscription: { type: String, enum: ['free', 'premium', 'professional'], default: 'free' },
  subscriptionExpiresAt: { type: Date, default: null },
  
  // AI Usage & Subscription
  aiUsageCount: { type: Number, default: 0 },
  aiLimit: { type: Number, default: 3 },
  subscriptionPlan: { type: String, enum: ['free', 'monthly', 'yearly'], default: 'free' },
  subscriptionExpiresAt: { type: Date, default: null },
  
  // Profile For Freelancers
  title: { type: String, default: '' },
  purpose: { type: String, default: '' },
  bio: { type: String, default: '' },
  skills: [{ type: String }],
  hourlyRate: { type: Number, default: 0 },
  experience: { type: String, default: '' },
  education: { type: String, default: '' },
  languages: [{ type: String }],
  portfolioLinks: [{ type: String }],
  portfolio: { type: mongoose.Schema.Types.ObjectId, ref: 'Portfolio', default: null },
  
  // Ratings & Reviews
  rating: { type: Number, default: 0, min: 0, max: 5 },
  ratingCount: { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },
  
  // Wallet (references Wallet model for balance)
  wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', default: null },
  
  // Escrow Holdings
  escrowTotal: { type: Number, default: 0 },
  
  // Trust & Gamification
  trustScore: { type: Number, default: 50, min: 0, max: 100 },
  totalXP: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  totalCompletedJobs: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  
  // Compliance & Violations
  violationCount: { type: Number, default: 0 },
  lastViolationDate: { type: Date, default: null },
  isRepeatOffender: { type: Boolean, default: false },
  
  // Bank Details (For Withdrawals)
  bankDetails: {
    accountNumber: { type: String, default: null },
    bankCode: { type: String, default: null },
    accountName: { type: String, default: null },
  },
  
  // References
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  referralCode: { type: String, unique: true, sparse: true },
  referralEarnings: { type: Number, default: 0 },
  
  // Timestamps
  lastLogin: { type: Date, default: null },
  lastActive: { type: Date, default: null },
}, { timestamps: true });

// Ensure email is always normalized before saving
userSchema.pre('save', function(next) {
  if (this.isModified('email') && typeof this.email === 'string') {
    this.email = this.email.trim().toLowerCase();
  }
  next();
});

// Ensure role is set based on userType before saving
userSchema.pre('save', function(next) {
  if (this.userType === 'admin') {
    this.role = 'admin';
  } else {
    this.role = 'user';
  }
  next();
});

// Hash password before saving (skip if Google OAuth or password is null)
userSchema.pre('save', async function(next) {
  // Skip password hashing for Google OAuth users
  if (this.authProvider === 'google' || !this.password) {
    return next();
  }

  // Only hash if password is modified
  if (!this.isModified('password')) return next();

  try {
      // Ensure password is a valid string before hashing
      if (typeof this.password !== 'string') {
        return next(new Error('Password must be a valid string'));
      }

      const hashedPassword = await bcrypt.hash(this.password, 12);
      this.password = hashedPassword;
      next();
    } catch (err) {
      next(err);
    }
  });
// Method to compare passwords
userSchema.methods.matchPassword = async function(enteredPassword) {
  // Google OAuth users don't have passwords
  if (this.authProvider === 'google' || !this.password) {
    return false;
  }
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.index({ email: 1, role: 1, userType: 1 });
userSchema.index({ verificationToken: 1 }, { sparse: true });
userSchema.index({ userType: 1, status: 1, isTopUser: -1, isPremium: -1, rating: -1, totalCompletedJobs: -1 });
userSchema.index({ userType: 1, skills: 1, rating: -1 });
userSchema.index({ firstName: 'text', lastName: 'text', bio: 'text', skills: 'text' });

// Hide sensitive data in JSON response
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.verificationToken;
  delete user.__v;
  // Add role field for frontend compatibility
  user.role = user.userType;
  user.isVerified = Boolean(user.verified);
  user.premium = Boolean(user.isPremium);
  return user;
};

module.exports = mongoose.model('User', userSchema);
