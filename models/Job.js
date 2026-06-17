const mongoose = require('mongoose');
const JOB_TITLE_MIN_LENGTH = 5;

const jobSchema = new mongoose.Schema({
  // Core Job Details
  title: { 
    type: String, 
    required: [true, 'Job title is required'],
    minlength: [JOB_TITLE_MIN_LENGTH, `Title must be at least ${JOB_TITLE_MIN_LENGTH} characters`],
    maxlength: [200, 'Title cannot exceed 200 characters'],
    trim: true
  },
  description: { 
    type: String, 
    required: [true, 'Job description is required'],
    minlength: [50, 'Description must be at least 50 characters'],
    maxlength: [5000, 'Description cannot exceed 5000 characters'],
    trim: true
  },
  category: { 
    type: String, 
    enum: {
      values: ['remote', 'local'],
      message: 'Category must be either "remote" or "local"'
    },
    required: [true, 'Category is required']
  },
  listingType: {
    type: String,
    enum: {
      values: ['local_job', 'remote_project', 'service'],
      message: 'Listing type must be local_job, remote_project, or service'
    },
    default: null,
  },
  subcategory: { type: String, default: '', trim: true },
  images: [{ type: String }],
  budget: { 
    type: Number, 
    required: [true, 'Budget is required'],
    min: [1, 'Budget must be greater than 0'],
    max: [10000000, 'Budget cannot exceed 10,000,000'],
    validate: {
      validator: function(value) {
        return value > 0 && Number.isFinite(value);
      },
      message: 'Budget must be a valid positive number'
    }
  },
  currency: { type: String, default: 'NGN', enum: ['NGN', 'USD', 'GBP'] },
  location: {
    country: { type: String, default: '' },
    state: { type: String, default: '' },
    city: { type: String, default: '' },
    address: { type: String, default: '' },
    coordinates: { type: [Number], default: [0, 0] }
  },
  skills: [{ type: String }],
  experienceLevel: { type: String, enum: ['beginner', 'intermediate', 'expert'], default: 'intermediate' },
  deadline: { type: Date, default: null },
  estimatedDuration: { type: String, default: null },

  // Ownership
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: [true, 'Job creator (posted_by) is required'],
    validate: {
      validator: async function(value) {
        // Validate that the user exists
        if (!value) return false;
        const User = mongoose.model('User');
        const user = await User.findById(value);
        return !!user;
      },
      message: 'Job creator does not exist'
    }
  },
  clientId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: [true, 'Client ID is required'],
    validate: {
      validator: function(value) {
        // clientId should equal createdBy for new jobs
        return value.equals(this.createdBy);
      },
      message: 'Client ID must match job creator'
    }
  },
  freelancerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    default: null,
    validate: {
      validator: function(value) {
        // If freelancer is assigned, it cannot be the same as createdBy (posted_by)
        if (!value) return true; // null is valid
        return !value.equals(this.createdBy);
      },
      message: 'Assigned freelancer cannot be the same as job creator'
    }
  },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Admin who assigned
  assignedAt: { type: Date, default: null },
  hiredAt: { type: Date, default: null },

  // Job status - with valid state transitions
  status: {
    type: String,
    enum: {
      values: ['open', 'in_progress', 'delivered', 'completed', 'cancelled', 'disputed'],
      message: 'Status must be one of: open, in_progress, delivered, completed, cancelled, disputed'
    },
    default: 'open',
    validate: {
      validator: function(value) {
        // Validate status transitions on update
        if (!this.isModified('status') || this.isNew) return true;
        
        const validTransitions = {
          'open': ['in_progress', 'cancelled'],
          'in_progress': ['delivered', 'disputed', 'cancelled'],
          'delivered': ['completed', 'disputed', 'in_progress'],
          'completed': [], // Terminal state
          'cancelled': [], // Terminal state
          'disputed': ['in_progress', 'completed', 'cancelled']
        };
        
        const currentStatus = this.getOriginal ? this.getOriginal('status') : this._original?.status;
        if (!currentStatus) return true; // New document
        
        return validTransitions[currentStatus]?.includes(value) ?? true;
      },
      message: 'Invalid status transition'
    }
  },
  flagged: { type: Boolean, default: false },

  // ===== ANTI-SCAM PROTECTION FIELDS =====
  scam_status: {
    type: String,
    enum: {
      values: ['safe', 'suspicious', 'blocked'],
      message: 'Scam status must be one of: safe, suspicious, blocked'
    },
    default: 'safe'
  },
  ai_scam_score: {
    type: Number,
    min: [0, 'Scam score must be between 0 and 100'],
    max: [100, 'Scam score must be between 0 and 100'],
    default: 0,
    validate: {
      validator: function(value) {
        return Number.isInteger(value) && value >= 0 && value <= 100;
      },
      message: 'Scam score must be an integer between 0 and 100'
    }
  },
  manual_verification: {
    type: Boolean,
    default: false
  },
  scam_reasons: [{
    type: String,
    enum: {
      values: ['zero_budget', 'suspicious_keywords', 'duplicate_job', 'spam_posting', 'vague_requirements', 'unrealistic_deadline', 'high_rating_demand', 'payment_outside_platform'],
      message: 'Invalid scam reason'
    }
  }],
  scam_flagged_at: { type: Date, default: null },
  scam_reviewed_at: { type: Date, default: null },
  scam_reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Payment & Escrow
  escrowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Escrow', default: null },
  escrowStatus: {
    type: String,
    enum: {
      values: ['pending', 'funded', 'released', 'refunded'],
      message: 'Escrow status must be one of: pending, funded, released, refunded'
    },
    default: 'pending'
  },
  escrowAmount: { type: Number, default: null },
  escrowFundedDate: { type: Date, default: null },
  escrowReleaseDate: { type: Date, default: null },
  escrowAutoReleaseDate: { type: Date, default: null },

  // Applications and proposals
  proposals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Proposal' }],
  applications: [{
    freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    proposalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Proposal', default: null },
    offerPrice: { type: Number, default: 0 },
    bidAmount: { type: Number, default: 0 },
    message: { type: String, default: '' },
    proposal: { type: String, default: '' },
    timelineInDays: { type: Number, default: null },
    deliveryDays: { type: Number, default: null },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'not_selected'],
      default: 'pending',
    },
    viewedByClient: { type: Boolean, default: false },
    appliedAt: { type: Date, default: Date.now },
    freelancerName: { type: String, default: '' },
    freelancerAvatar: { type: String, default: null },
    freelancerRating: { type: Number, default: 0 },
    freelancerRatingCount: { type: Number, default: 0 },
    freelancerTrustScore: { type: Number, default: 50 },
    freelancerTitle: { type: String, default: '' },
    freelancerSkills: [{ type: String }],
    freelancerVerified: { type: Boolean, default: false },
    freelancerIsPremium: { type: Boolean, default: false },
    freelancerIsTopUser: { type: Boolean, default: false },
  }],

  // Delivery and reviews
  deliveryText: { type: String, default: null },
  deliveryFiles: [{ type: String }],
  submittedAt: { type: Date, default: null },
  approvedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  clientReview: {
    rating: { type: Number, min: 1, max: 5, default: null },
    comment: { type: String, default: '' },
    createdAt: { type: Date, default: null }
  },
  freelancerReview: {
    rating: { type: Number, min: 1, max: 5, default: null },
    comment: { type: String, default: '' },
    createdAt: { type: Date, default: null }
  },

  // Marketplace metadata
  boostCount: { type: Number, default: 0 },
  viewCount: { type: Number, default: 0 },
  featured: { type: Boolean, default: false },
  isBoosted: { type: Boolean, default: false },
  boostedAt: { type: Date, default: null },
  isFeatured: { type: Boolean, default: false },
  featuredAt: { type: Date, default: null },

  // Local Job Features
  isLocal: { type: Boolean, default: false },
  onsiteDetails: { type: String, default: '' },
  arrivalDateTime: { type: Date, default: null },
  isUrgent: { type: Boolean, default: false },
  urgentExpiresAt: { type: Date, default: null },
  quickHire: { type: Boolean, default: false },
  quickHirePrice: { 
    type: Number, 
    default: null,
    validate: {
      validator: function(value) {
        // quickHirePrice should be set if quickHire is true
        if (this.quickHire && !value) return false;
        // If set, must be positive
        if (value && value <= 0) return false;
        return true;
      },
      message: 'Quick hire price must be a positive number if quick hire is enabled'
    }
  },
  distance: { type: Number, default: null }, // Calculated distance in km
  radius: { 
    type: Number, 
    default: 10,
    min: [1, 'Search radius must be at least 1 km'],
    max: [500, 'Search radius cannot exceed 500 km']
  },
  address: { 
    type: String, 
    default: '',
    validate: {
      validator: function(value) {
        // If category is 'local', address should be provided
        if (this.category === 'local' && !value) return false;
        return true;
      },
      message: 'Address is required for local jobs'
    }
  },
  contactPhone: { 
    type: String, 
    default: '',
    validate: {
      validator: function(value) {
        // If quickHire is true, contactPhone should be provided
        if (this.quickHire && !value) return false;
        // Basic phone validation if provided
        if (value && !/^[\d\s\-\+\(\)]{7,}$/.test(value)) return false;
        return true;
      },
      message: 'Valid contact phone is required for quick hire jobs'
    }
  },
  jobType: { 
    type: String, 
    enum: {
      values: ['fixed', 'hourly', 'quick_hire'],
      message: 'Job type must be one of: fixed, hourly, quick_hire'
    },
    default: 'fixed' 
  }
}, { timestamps: true });

// ===== PRE-SAVE HOOKS FOR VALIDATION =====

// Validate budget before saving
jobSchema.pre('save', function(next) {
  // Ensure budget is always positive
  if (!this.budget || this.budget <= 0) {
    return next(new Error('Budget must be greater than 0'));
  }
  next();
});

// Validate createdBy and freelancerId relationship
jobSchema.pre('save', function(next) {
  // Ensure createdBy exists
  if (!this.createdBy) {
    return next(new Error('Job creator (posted_by) is required'));
  }
  
  // Ensure clientId matches createdBy
  if (!this.clientId || !this.clientId.equals(this.createdBy)) {
    this.clientId = this.createdBy;
  }
  
  // Ensure freelancerId (assigned_to) is never equal to createdBy
  if (this.freelancerId && this.freelancerId.equals(this.createdBy)) {
    return next(new Error('Assigned freelancer cannot be the same as job creator'));
  }
  
  next();
});

// Validate location consistency for local jobs
jobSchema.pre('save', function(next) {
  if (this.category === 'local') {
    // Local jobs must have address and coordinates
    if (!this.address || !this.address.trim()) {
      return next(new Error('Address is required for local jobs'));
    }
    if (!this.location?.coordinates || this.location.coordinates.length !== 2) {
      return next(new Error('Valid coordinates are required for local jobs'));
    }
    if (!this.isLocal) {
      this.isLocal = true;
    }
  } else if (this.category === 'remote') {
    // Remote jobs should not have address/coordinates
    this.isLocal = false;
    this.address = '';
    this.contactPhone = '';
  }
  next();
});

// Validate work_type and location fields mapping
jobSchema.pre('save', function(next) {
  // Map category to work_type (for API compatibility)
  // category: 'remote' | 'local' → work_type: 'remote' | 'local'
  if (this.category === 'local' && !this.address) {
    return next(new Error('Address is required for local work type'));
  }
  next();
});

// ===== INDEXES FOR QUERY PERFORMANCE =====

jobSchema.index({ createdBy: 1, clientId: 1, freelancerId: 1, status: 1, category: 1, subcategory: 1 });
jobSchema.index({ createdBy: 1, status: 1, createdAt: -1 });
jobSchema.index({ freelancerId: 1, status: 1, createdAt: -1 });
jobSchema.index({ status: 1, isFeatured: -1, isBoosted: -1, boostCount: -1, createdAt: -1 });
jobSchema.index({ status: 1, category: 1, createdAt: -1 });
jobSchema.index({ status: 1, listingType: 1, createdAt: -1 });
jobSchema.index({ status: 1, skills: 1, createdAt: -1 });
jobSchema.index({ title: 'text', description: 'text', subcategory: 'text', skills: 'text' });
jobSchema.index({ 'location.country': 1, 'location.state': 1, 'location.city': 1 });
jobSchema.index({ 'location.coordinates': '2dsphere' });
jobSchema.index({ viewCount: -1, createdAt: -1 });

module.exports = mongoose.model('Job', jobSchema);
