const mongoose = require('mongoose');

const hireSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  budget: {
    type: Number,
    required: true,
    min: 0
  },
  skills: [{
    type: String,
    trim: true
  }],
  deadline: {
    type: Date
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['open', 'assigned', 'in_progress', 'completed', 'cancelled'],
    default: 'open'
  },
  proposals: [{
    freelancerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    bidAmount: Number,
    coverLetter: String,
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending'
    },
    submittedAt: {
      type: Date,
      default: Date.now
    }
  }],
  attachments: [{
    filename: String,
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  completedAt: Date,
  rating: {
    clientRating: Number,
    freelancerRating: Number,
    clientReview: String,
    freelancerReview: String
  }
}, {
  timestamps: true
});

// Indexes for performance
hireSchema.index({ clientId: 1, status: 1 });
hireSchema.index({ workerId: 1, status: 1 });
hireSchema.index({ category: 1, status: 1 });
hireSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Hire', hireSchema);