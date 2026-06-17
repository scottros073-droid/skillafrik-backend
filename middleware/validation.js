// filepath: backend/middleware/validation.js
const { z } = require('zod');
const logger = require('../utils/logger');
const JOB_TITLE_MIN_LENGTH = 5;

// ===== SANITIZATION HELPERS =====
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return str.trim().replace(/\s+/g, ' ');
};

const sanitizeEmail = (email) => {
  return email.trim().toLowerCase();
};

// ===== COMMON SCHEMAS =====
const emailSchema = z.string()
  .email('Invalid email format')
  .max(255, 'Email too long')
  .transform(sanitizeEmail);

const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const nameSchema = z.string()
  .min(2, 'Name must be at least 2 characters')
  .max(50, 'Name too long')
  .regex(/^[a-zA-Z\s'-]+$/, 'Name contains invalid characters')
  .transform(sanitizeString);

// ===== LOGIN VALIDATION =====
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required')
});

// ===== SIGNUP VALIDATION =====
const signupSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['freelancer', 'client']).optional(),
  phone: z.string().optional(),
  country: z.string().optional()
}).transform((data) => ({
  ...data,
  userType: data.role || 'freelancer'
}));

// ===== JOB VALIDATION =====
const jobSchema = z.object({
  title: z.string()
    .min(JOB_TITLE_MIN_LENGTH, `Title must be at least ${JOB_TITLE_MIN_LENGTH} characters`)
    .max(200, 'Title too long')
    .transform(sanitizeString),
  description: z.string()
    .min(50, 'Description must be at least 50 characters')
    .max(5000, 'Description too long')
    .transform(sanitizeString),
  category: z.enum(['remote', 'local'], {
    errorMap: () => ({ message: 'Category must be either "remote" or "local"' })
  }),
  subcategory: z.string()
    .max(100, 'Subcategory too long')
    .transform(sanitizeString)
    .optional(),
  budget: z.number()
    .positive('Budget must be greater than 0')
    .min(1, 'Budget must be greater than 0')
    .max(10000000, 'Maximum budget is 10,000,000')
    .refine(value => Number.isFinite(value), 'Budget must be a valid number'),
  currency: z.enum(['NGN', 'USD', 'GBP']).optional(),
  experienceLevel: z.enum(['beginner', 'intermediate', 'expert']).optional(),
  duration: z.string()
    .max(50, 'Duration too long')
    .optional(),
  skills: z.array(z.string().max(100))
    .max(20, 'Maximum 20 skills allowed')
    .optional(),
  location: z.object({
    country: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    city: z.string().max(100).optional(),
    coordinates: z.array(z.number().min(-180).max(180))
      .length(2, 'Coordinates must be [longitude, latitude]')
      .optional()
  }).optional(),
  address: z.string()
    .max(300, 'Address too long')
    .optional(),
  contactPhone: z.string()
    .regex(/^[\d\s\-\+\(\)]{7,}$/, 'Invalid phone number format')
    .optional(),
  isUrgent: z.boolean().optional(),
  isLocal: z.boolean().optional(),
  quickHire: z.boolean().optional(),
  quickHirePrice: z.number()
    .positive('Quick hire price must be positive')
    .optional(),
  jobType: z.enum(['fixed', 'hourly', 'quick_hire']).optional(),
  radius: z.number()
    .min(1, 'Search radius must be at least 1 km')
    .max(500, 'Search radius cannot exceed 500 km')
    .optional()
}).refine(
  (data) => {
    // If category is 'local', address must be provided
    if (data.category === 'local' && !data.address) {
      return false;
    }
    return true;
  },
  {
    message: 'Address is required for local jobs',
    path: ['address']
  }
).refine(
  (data) => {
    // If quickHire is true, quickHirePrice must be provided
    if (data.quickHire && !data.quickHirePrice) {
      return false;
    }
    return true;
  },
  {
    message: 'Quick hire price is required when quick hire is enabled',
    path: ['quickHirePrice']
  }
).refine(
  (data) => {
    // If quickHire is true, contactPhone must be provided
    if (data.quickHire && !data.contactPhone) {
      return false;
    }
    return true;
  },
  {
    message: 'Contact phone is required for quick hire jobs',
    path: ['contactPhone']
  }
);

// ===== PROPOSAL VALIDATION =====
const proposalSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required').max(255),
  coverLetter: z.string()
    .min(100, 'Cover letter must be at least 100 characters')
    .max(2000, 'Cover letter too long')
    .transform(sanitizeString),
  proposedBudget: z.number()
    .positive('Budget must be positive')
    .min(100, 'Minimum budget is 100')
    .optional(),
  estimatedDuration: z.string()
    .max(50, 'Duration too long')
    .optional()
});

// ===== PAYMENT VALIDATION =====
const paymentSchema = z.object({
  amount: z.number()
    .positive('Amount must be positive')
    .min(100, 'Minimum amount is 100 Naira')
    .max(10000000, 'Maximum amount is 10,000,000 Naira'),
  email: emailSchema,
  callbackUrl: z.string().url().optional(),
  purpose: z.enum(['job_escrow', 'verification', 'top_user', 'company_hiring', 'upgrade']).optional(),
  metadata: z.any().optional()
});

// ===== PROFILE UPDATE VALIDATION =====
const profileUpdateSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  bio: z.string()
    .max(500, 'Bio too long')
    .transform(sanitizeString)
    .optional(),
  skills: z.array(z.string().max(100)).max(30, 'Maximum 30 skills').optional(),
  hourlyRate: z.number()
    .positive('Rate must be positive')
    .min(100, 'Minimum rate is 100')
    .max(1000000, 'Maximum rate is 1,000,000')
    .optional(),
  location: z.object({
    type: z.string().optional(),
    coordinates: z.array(z.number()).optional(),
    address: z.string().max(300).optional()
  }).optional()
});

// ===== MESSAGE VALIDATION =====
const messageSchema = z.object({
  recipientId: z.string().min(1, 'Recipient ID is required').max(255),
  content: z.string()
    .min(1, 'Message content is required')
    .max(2000, 'Message too long')
    .transform(sanitizeString)
});

// ===== AI VALIDATION SCHEMAS =====
const aiProposalSchema = z.object({
  jobTitle: z.string()
    .min(10, 'Job title must be at least 10 characters')
    .max(200, 'Title too long')
    .transform(sanitizeString),
  jobDescription: z.string()
    .min(50, 'Job description must be at least 50 characters')
    .max(2000, 'Description too long')
    .transform(sanitizeString),
  freelancerBio: z.string()
    .min(10, 'Freelancer bio must be at least 10 characters')
    .max(1000, 'Bio too long')
    .transform(sanitizeString)
    .optional()
});

const aiCVSchema = z.object({
  personalInfo: z.object({
    name: z.string().min(1, 'Name is required').max(100),
    email: emailSchema,
    phone: z.string().max(20).optional(),
    location: z.string().max(100).optional()
  }),
  experience: z.array(z.object({
    title: z.string().min(1, 'Job title is required').max(100),
    company: z.string().min(1, 'Company is required').max(100),
    duration: z.string().min(1, 'Duration is required').max(100),
    description: z.string().min(10, 'Description required').max(1000)
  })).max(20, 'Maximum 20 experience entries').optional(),
  education: z.array(z.object({
    degree: z.string().min(1, 'Degree is required').max(100),
    institution: z.string().min(1, 'Institution is required').max(100),
    year: z.string().min(4, 'Year is required').max(4)
  })).max(10, 'Maximum 10 education entries').optional(),
  skills: z.array(z.string().max(100)).max(30, 'Maximum 30 skills').optional()
});

const aiJobDescriptionSchema = z.object({
  title: z.string()
    .min(10, 'Title must be at least 10 characters')
    .max(100, 'Title too long')
    .transform(sanitizeString),
  category: z.string()
    .min(1, 'Category is required')
    .max(100)
    .transform(sanitizeString),
  budget: z.number()
    .positive('Budget must be positive')
    .min(100, 'Minimum budget is 100')
    .optional(),
  requirements: z.string()
    .min(50, 'Requirements must be at least 50 characters')
    .max(2000, 'Requirements too long')
    .transform(sanitizeString)
});

const aiPortfolioSchema = z.object({
  title: z.string()
    .min(5, 'Title must be at least 5 characters')
    .max(100, 'Title too long')
    .transform(sanitizeString),
  description: z.string()
    .min(50, 'Description must be at least 50 characters')
    .max(1000, 'Description too long')
    .transform(sanitizeString),
  skills: z.array(z.string().max(100)).min(1, 'At least one skill is required').max(20)
});

const aiAnalysisSchema = z.object({
  proposal: z.string()
    .min(50, 'Proposal must be at least 50 characters')
    .max(2000, 'Proposal too long')
    .transform(sanitizeString),
  jobTitle: z.string()
    .min(5, 'Job title is required')
    .max(200)
    .transform(sanitizeString),
  jobDescription: z.string()
    .min(50, 'Job description is required')
    .max(2000)
    .transform(sanitizeString)
});

const aiDesignSchema = z.object({
  type: z.enum(['logo', 'banner', 'thumbnail']).optional(),
  description: z.string()
    .min(20, 'Description must be at least 20 characters')
    .max(1000, 'Description too long')
    .transform(sanitizeString)
});

// ===== HIRE VALIDATION =====
const hireSchema = z.object({
  freelancerId: z.string().min(1, 'Freelancer ID is required').max(255),
  title: z.string()
    .min(10, 'Title must be at least 10 characters')
    .max(200, 'Title too long')
    .transform(sanitizeString),
  description: z.string()
    .min(50, 'Description must be at least 50 characters')
    .max(2000, 'Description too long')
    .transform(sanitizeString),
  budget: z.number()
    .positive('Budget must be positive')
    .min(100, 'Minimum budget is 100')
    .max(1000000, 'Maximum budget is 1,000,000'),
  deadline: z.string()
    .datetime('Invalid date format')
    .optional()
});

// ===== REVIEW VALIDATION =====
const reviewSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required').max(255),
  rating: z.number()
    .int('Rating must be a whole number')
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating cannot exceed 5'),
  comment: z.string()
    .min(10, 'Comment must be at least 10 characters')
    .max(1000, 'Comment too long')
    .transform(sanitizeString)
    .optional(),
  recipientId: z.string().min(1, 'Recipient ID is required').max(255)
});

// ===== WITHDRAWAL VALIDATION =====
const withdrawalSchema = z.object({
  amount: z.number()
    .positive('Amount must be positive')
    .min(1000, 'Minimum withdrawal is 1,000 Naira')
    .max(10000000, 'Maximum withdrawal is 10,000,000 Naira'),
  bankCode: z.string().min(1, 'Bank code is required').max(10),
  accountNumber: z.string()
    .regex(/^\d{10}$/, 'Account number must be 10 digits')
});

// ===== VALIDATION MIDDLEWARE FACTORY =====
const validate = (schema) => {
  return (req, res, next) => {
    try {
      const validated = schema.parse(req.body);
      req.validated = validated;
      next();
    } catch (error) {
      logger.warn('Validation failed', { 
        path: req.path,
        method: req.method,
        userId: req.user?.id || 'anonymous'
      });
      
      if (error instanceof z.ZodError) {
        const issues = error.issues || [];
        const firstIssue = Array.isArray(issues) && issues.length ? issues[0] : null;
        const readableMessage = firstIssue
          ? `${firstIssue.path?.join('.') || 'Field'} ${firstIssue.message}`.trim()
          : 'Validation failed';

        return res.status(400).json({
          success: false,
          message: readableMessage,
          errors: Array.isArray(issues) ? issues.map(e => ({
            field: e.path.join('.'),
            message: e.message
          })) : []
        });
      }
      return res.status(400).json({
        success: false,
        message: error.message || 'Validation error'
      });
    }
  };
};

module.exports = {
  validate,
  sanitizeString,
  sanitizeEmail,
  loginSchema,
  signupSchema,
  jobSchema,
  proposalSchema,
  paymentSchema,
  profileUpdateSchema,
  messageSchema,
  aiProposalSchema,
  aiCVSchema,
  aiJobDescriptionSchema,
  aiPortfolioSchema,
  aiAnalysisSchema,
  aiDesignSchema,
  hireSchema,
  reviewSchema,
  withdrawalSchema
};
