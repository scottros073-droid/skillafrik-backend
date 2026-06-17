const mongoose = require('mongoose');

const portfolioSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  title: { type: String, required: true },
  description: { type: String, default: '' },
  
  // Projects
  projects: [{
    title: { type: String, required: true },
    description: { type: String, default: '' },
    link: { type: String, default: null },
    image: { type: String, default: null },
    completedAt: { type: Date, default: null },
  }],
  
  // Metadata
  viewCount: { type: Number, default: 0 },
  isPublic: { type: Boolean, default: true },
  
}, { timestamps: true });

portfolioSchema.index({ userId: 1 });

module.exports = mongoose.model('Portfolio', portfolioSchema);
