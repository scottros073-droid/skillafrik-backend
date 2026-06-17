/**
 * Safe money conversion utilities
 * Handles currency conversion with precision to prevent loss of funds
 */

/**
 * Convert naira to kobo (currency base units)
 * Always rounds UP to ensure we never short-change customers
 * 
 * @param {number} naira - Amount in naira (NGN)
 * @returns {number} Amount in kobo
 * @throws {Error} if amount is invalid
 */
function nairaToKobo(naira) {
  // Validate input
  if (typeof naira !== 'number' || naira < 0) {
    throw new Error('Amount must be a non-negative number');
  }

  // Check if amount has more than 2 decimal places
  if (naira * 100 !== Math.floor(naira * 100)) {
    throw new Error('Amount must not have more than 2 decimal places');
  }

  // Convert to kobo, rounding UP to prevent loss
  const kobo = Math.ceil(naira * 100);
  return kobo;
}

/**
 * Convert kobo to naira
 * @param {number} kobo - Amount in kobo
 * @returns {number} Amount in naira
 */
function koboToNaira(kobo) {
  if (typeof kobo !== 'number' || kobo < 0) {
    throw new Error('Amount must be a non-negative number');
  }
  return kobo / 100;
}

/**
 * Validate payment amount
 * @param {number} amount - Amount in naira
 * @returns {boolean} true if valid
 * @throws {Error} if invalid
 */
function validateAmount(amount) {
  if (typeof amount !== 'number' || amount <= 0) {
    throw new Error('Amount must be a positive number');
  }

  if (amount * 100 !== Math.floor(amount * 100)) {
    throw new Error('Amount must have at most 2 decimal places');
  }

  if (amount > 999999999) {
    throw new Error('Amount exceeds maximum allowed');
  }

  return true;
}

/**
 * Safely compare two monetary amounts in naira
 * @param {number} amount1 - First amount in naira
 * @param {number} amount2 - Second amount in naira
 * @returns {boolean} true if amounts are equal
 */
function amountsEqual(amount1, amount2) {
  try {
    const kobo1 = Math.ceil(amount1 * 100);
    const kobo2 = Math.ceil(amount2 * 100);
    return kobo1 === kobo2;
  } catch {
    return false;
  }
}

module.exports = {
  nairaToKobo,
  koboToNaira,
  validateAmount,
  amountsEqual
};
