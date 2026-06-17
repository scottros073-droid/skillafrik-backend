const mongoose = require('mongoose');
const Payment = require('../models/Payment');

const resolvePaymentByReference = async (reference, purpose = null, session = null) => {
  if (!reference) return null;

  const baseQuery = purpose ? { purpose } : {};
  let query = Payment.findOne({ ...baseQuery, gatewayRef: String(reference) });
  if (session) query = query.session(session);
  let payment = await query;

  if (!payment && mongoose.Types.ObjectId.isValid(String(reference))) {
    query = Payment.findById(reference);
    if (purpose) query = query.where({ purpose });
    if (session) query = query.session(session);
    payment = await query;
  }

  return payment;
};

module.exports = {
  resolvePaymentByReference,
};
