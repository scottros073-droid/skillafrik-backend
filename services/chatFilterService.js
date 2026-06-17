// filepath: backend/services/chatFilterService.js
const crypto = require('crypto');

// ===== CONTACT EXCHANGE PATTERNS TO BLOCK =====
const BLOCKED_PATTERNS = [
  // Phone numbers (various formats)
  /(\+?234[0-9]{10})/g,
  /(0[0-9]{10})/g,
  /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/g,
  /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  
  // Contact exchange attempts
  /(?:whatsapp|whats app|wa me|chat on whatsapp|call me on|reach me on|contact me on|pm me|message me|hit me up)/gi,
  /(?:my number|my phone|my contact|my email|my whatsapp)/gi,
  /(?:save my number|save this number|store my|keep my)/gi,
  
  // External links (except allowed platforms)
  /(?:t\.me\/|telegram\.me\/)/g,
  /(?:wa\.me\/|whatsapp\.com\/)/g,
  
  // Social media handles
  /@[\w]{3,30}/g
];

// ===== WARNING MESSAGES =====
const WARNING_MESSAGES = [
  "⚠️ Please keep communication within SkillAfrik for your safety.",
  "⚠️ Sharing contact info outside the platform violates our terms of service.",
  "⚠️ For your protection, please stay on SkillAfrik until the job is completed."
];

// ===== SPAM PATTERNS =====
const SPAM_PATTERNS = [
  /(?:click here|click this|visit my website|check my profile)/gi,
  /(?:earn money|make money|passive income|work from home|mlm)/gi,
  /(?:congratulations|you won|winner|prize|lottery)/gi,
  /(?:buy now|limited offer|act now|don't miss)/gi
];

// ===== FILTER MESSAGE =====
const filterMessage = (message) => {
  const originalMessage = message;
  let warnings = [];
  let isBlocked = false;
  let blockedReason = '';
  
  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(message)) {
      isBlocked = true;
      blockedReason = 'Contact information detected';
      break;
    }
  }
  
  // Check for spam patterns
  if (!isBlocked) {
    for (const pattern of SPAM_PATTERNS) {
      if (pattern.test(message)) {
        warnings.push('Potential spam detected');
        break;
      }
    }
  }
  
  // Check for excessive caps (spam indicator)
  const capsCount = (message.match(/[A-Z]/g) || []).length;
  const totalChars = message.replace(/[^a-zA-Z]/g, '').length;
  if (totalChars > 10 && capsCount / totalChars > 0.6) {
    warnings.push('Excessive capitalization detected');
  }
  
  // Check for repeated characters (spamming)
  if (/(.)\1{4,}/.test(message)) {
    warnings.push('Repeated characters detected');
  }
  
  return {
    isBlocked,
    blockedReason,
    warnings,
    shouldWarn: warnings.length > 0,
    filteredMessage: isBlocked ? null : message
  };
};

// ===== SANITIZE MESSAGE =====
const sanitizeMessage = (message) => {
  // Remove excessive whitespace
  let sanitized = message.replace(/\s+/g, ' ').trim();
  
  // Remove zero-width characters
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');
  
  // Limit message length
  if (sanitized.length > 2000) {
    sanitized = sanitized.substring(0, 2000);
  }
  
  return sanitized;
};

// ===== GET RANDOM WARNING =====
const getRandomWarning = () => {
  return WARNING_MESSAGES[Math.floor(Math.random() * WARNING_MESSAGES.length)];
};

// ===== DETECT EXTERNAL PLATFORM =====
const detectExternalPlatform = (message) => {
  const platforms = {
    whatsapp: /whatsapp|wa\.me|whats app/i,
    telegram: /telegram|t\.me|@[\w]{3,30}/i,
    email: /@[\w]+\.[\w]+/i,
    phone: /\d{10,}/i
  };
  
  for (const [platform, pattern] of Object.entries(platforms)) {
    if (pattern.test(message)) {
      return platform;
    }
  }
  
  return null;
};

// ===== CHECK MESSAGE SAFETY =====
const checkMessageSafety = (message) => {
  const filterResult = filterMessage(message);
  const sanitized = sanitizeMessage(message);
  const platform = detectExternalPlatform(message);
  
  return {
    ...filterResult,
    sanitized,
    detectedPlatform: platform,
    isSafe: !filterResult.isBlocked && !platform
  };
};

module.exports = {
  filterMessage,
  sanitizeMessage,
  getRandomWarning,
  detectExternalPlatform,
  checkMessageSafety,
  BLOCKED_PATTERNS,
  WARNING_MESSAGES,
  SPAM_PATTERNS
};