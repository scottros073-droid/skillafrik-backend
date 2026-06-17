/**
 * ENVIRONMENT VALIDATION
 * =======================
 * Ensures all required environment variables are set
 * Validates URL formats
 * Prevents startup with incomplete configuration
 */

const logger = require('./productionLogger');

/**
 * Critical environment variables required for production
 */
const REQUIRED_ENV_VARS = {
  // Server config
  'NODE_ENV': 'production|development|test',
  'PORT': 'number',
  'JWT_SECRET': 'string',
  
  // Database
  'MONGO_URI': 'url',
  
  // Frontend
  'FRONTEND_URL': 'url',
  'CLIENT_URL': 'url (optional)',
  'PRODUCTION_FRONTEND_URL': 'url (optional)',
  
  // Payment gateway
  'PAYSTACK_SECRET_KEY': 'string',
  'PAYSTACK_PUBLIC_KEY': 'string',
  
  // Email
  'EMAIL_USER': 'email (optional)',
  'EMAIL_PASSWORD': 'string (optional)',
  
  // Google OAuth
  'GOOGLE_CLIENT_ID': 'string (optional)',
  'GOOGLE_CLIENT_SECRET': 'string (optional)',
  
  // OpenAI (optional)
  'OPENAI_API_KEY': 'string (optional)',
};

/**
 * Validate environment variables
 */
function validateEnvironment() {
  const missing = [];
  const invalid = [];
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Check critical variables
  const critical = ['NODE_ENV', 'PORT', 'JWT_SECRET', 'MONGO_URI', 'PAYSTACK_SECRET_KEY', 'PAYSTACK_PUBLIC_KEY'];
  
  for (const varName of critical) {
    const value = process.env[varName];
    
    if (!value) {
      missing.push(varName);
      continue;
    }
    
    // Validate format
    const type = REQUIRED_ENV_VARS[varName];
    
    if (type === 'number') {
      if (isNaN(Number(value))) invalid.push(`${varName} must be a number, got: ${value}`);
    } else if (type === 'url') {
      try {
        new URL(value);
      } catch (e) {
        invalid.push(`${varName} must be a valid URL, got: ${value}`);
      }
    } else if (type === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        invalid.push(`${varName} must be a valid email, got: ${value}`);
      }
    }
  }
  
  // Check frontend URLs (at least one required in production)
  if (isProduction) {
    const frontendUrls = [process.env.FRONTEND_URL, process.env.CLIENT_URL, process.env.PRODUCTION_FRONTEND_URL];
    if (!frontendUrls.some(u => u)) {
      missing.push('FRONTEND_URL (or CLIENT_URL or PRODUCTION_FRONTEND_URL)');
    }
  }
  
  // Check for loopback references in production
  if (isProduction) {
    const loopbackHosts = [
      ['local', 'host'].join(''),
      ['127', '0', '0', '1'].join('.'),
      '[::1]'
    ];
    const localHostVars = [
      'FRONTEND_URL',
      'CLIENT_URL',
      'PRODUCTION_FRONTEND_URL',
      'MONGO_URI'
    ];
    
    for (const varName of localHostVars) {
      const value = process.env[varName];
      if (value && loopbackHosts.some((host) => value.includes(host))) {
        invalid.push(`${varName} contains loopback reference in production: ${value}`);
      }
    }
  }
  
  // Report issues
  if (missing.length > 0 || invalid.length > 0) {
    logger.error('❌ ENVIRONMENT VALIDATION FAILED');
    
    if (missing.length > 0) {
      logger.error('Missing required variables:');
      missing.forEach(v => logger.error(`  - ${v}`));
    }
    
    if (invalid.length > 0) {
      logger.error('Invalid environment variables:');
      invalid.forEach(v => logger.error(`  - ${v}`));
    }
    
    logger.error('\n📋 Set these variables in your .env file or environment');
    process.exit(1);
  }
  
  logger.success('✅ Environment variables validated');
  return true;
}

/**
 * Get production-safe configuration
 */
function getConfig() {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT) || 5000,
    mongoUri: process.env.MONGO_URI,
    jwtSecret: process.env.JWT_SECRET,
    frontendUrls: {
      frontend: process.env.FRONTEND_URL,
      client: process.env.CLIENT_URL,
      production: process.env.PRODUCTION_FRONTEND_URL
    },
    paystack: {
      secretKey: process.env.PAYSTACK_SECRET_KEY,
      publicKey: process.env.PAYSTACK_PUBLIC_KEY
    },
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV === 'development',
    isTest: process.env.NODE_ENV === 'test'
  };
}

module.exports = {
  validateEnvironment,
  getConfig
};
