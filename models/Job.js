const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'NGN' },
  deadline: { type: Date },

  // Who posted / assigned the job
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, 
  workerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  status: { type: String, enum: ['OPEN', 'DELIVERED', 'COMPLETED'], default: 'OPEN' },

  // Escrow/payment info
  escrowPaid: { type: Boolean, default: false },
  escrow: {
    status: { type: String, enum: ['HELD', 'RELEASED', null], default: null },
  },

  // Delivery info (filled by worker)
  delivery: {
    files: [String],
    message: String,
    deliveredAt: Date,
  },

  // Reviews (filled by company/client)
  reviews: [
    {
      reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      rating: { type: Number, min: 1, max: 5 },
      comment: String,
      createdAt: { type: Date, default: Date.now },
    },
  ],
}, { timestamps: true });

// Validation: at least one of companyId or workerId must exist
jobSchema.pre('validate', function (next) {
  if (!this.companyId && !this.workerId) {
    next(new Error('Either companyId or workerId is required.'));
  } else {
    next();
  }
});

module.exports = mongoose.model('Job', jobSchema);
