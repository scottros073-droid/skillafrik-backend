// backend/utils/spamFilter.js
const blockedPatterns = [
  /[\d]{7,}/g, // phone numbers or long digit sequences
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // email addresses
  /(whatsapp|wa\.me|chat\.whatsapp\.com|telegram|tg:)/gi
];

const containsBlockedCommunication = (text = '') => {
  if (!text || typeof text !== 'string') return false;
  return blockedPatterns.some((pattern) => pattern.test(text));
};

module.exports = {
  containsBlockedCommunication
};