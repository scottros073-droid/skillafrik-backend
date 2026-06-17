const paystackService = require('../utils/paystack');
const { nairaToKobo, validateAmount, amountsEqual } = require('../utils/moneyUtils');
const Payment = require('../models/Payment');
const Escrow = require('../models/Escrow');
const monetizationService = require('../services/monetizationService');
const escrowController = require('../controllers/escrowController');
const subscriptionService = require('../services/subscriptionService');
const logger = require('../utils/logger');
const { getAllowedOrigins } = require('../config/corsConfig');
const { resolvePaymentByReference } = require('../utils/paymentResolver');

const isAllowedCallbackUrl = (callbackUrl) => {
  if (!callbackUrl) return true;

  try {
    const url = new URL(callbackUrl);
    const allowedOrigins = getAllowedOrigins();

    return allowedOrigins.includes(url.origin);
  } catch {
    return false;
  }
};

const normalizePaymentPurpose = (purpose) => {
  if (purpose === 'premium_upgrade') return 'subscription';
  if (purpose === 'verification') return 'verify';
  return purpose || 'general';
};

// Initiate payment
const initiatePayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, email } = req.body;
    const metadata = { ...(req.body.metadata || {}) };
    const purpose = normalizePaymentPurpose(metadata.purpose || req.body.purpose);
    metadata.purpose = purpose;
    const callbackUrl = req.body.callbackUrl || req.body.callback_url;

    // Validate amount with safe money utilities
    validateAmount(amount);
    const amountInKobo = nairaToKobo(amount);

    if (!isAllowedCallbackUrl(callbackUrl)) {
      logger.warn('Payment initialization rejected: untrusted callback URL', {
        requestId: req.requestId,
        userId,
        callbackUrl,
        ip: req.ip
      });
      return res.status(400).json({ success: false, message: 'Invalid payment callback URL' });
    }

    if (purpose === 'job_escrow') {
      if (!metadata?.escrowId) {
        return res.status(400).json({ success: false, message: 'Escrow ID is required for job escrow payments' });
      }

      const escrow = await Escrow.findById(metadata.escrowId);
      if (!escrow) {
        return res.status(404).json({ success: false, message: 'Escrow not found' });
      }

      if (escrow.clientId.toString() !== userId.toString()) {
        return res.status(403).json({ success: false, message: 'Only the client who created the escrow may pay for it' });
      }

      if (escrow.clientId.toString() === escrow.freelancerId.toString()) {
        return res.status(400).json({ success: false, message: 'Invalid escrow: payer cannot equal receiver' });
      }

      if (escrow.status === 'FUNDED') {
        return res.status(400).json({ success: false, message: 'Escrow has already been funded' });
      }

      if (escrow.status !== 'PENDING') {
        return res.status(400).json({ success: false, message: 'Escrow is not available for payment' });
      }

      const completedEscrowPayment = await Payment.findOne({
        userId,
        purpose: 'job_escrow',
        status: 'PAID',
        'metadata.escrowId': metadata.escrowId,
      });
      if (completedEscrowPayment) {
        return res.status(400).json({ success: false, message: 'Escrow payment has already been completed' });
      }

      // Safe amount comparison
      if (!amountsEqual(amount, escrow.amount)) {
        return res.status(400).json({ success: false, message: 'Payment amount must match the escrow amount' });
      }

      metadata.jobId = metadata.jobId || escrow.jobId?.toString();
    }

    // Reuse any existing pending payment for this job escrow or deposit to prevent duplicates
    let payment = null;
    if (purpose === 'job_escrow' && metadata?.escrowId) {
      payment = await Payment.findOne({
        userId,
        purpose: 'job_escrow',
        status: 'PENDING',
        'metadata.escrowId': metadata.escrowId,
      }).sort({ createdAt: -1 });
    } else if (purpose === 'deposit') {
      payment = await Payment.findOne({
        userId,
        purpose: 'deposit',
        status: 'PENDING',
        amount: amountInKobo
      });
    }

    const reusedExistingPayment = Boolean(payment);

    if (!payment) {
      payment = await Payment.create({
        userId,
        jobId: metadata?.jobId || null,
        amount: amountInKobo, // Store in kobo using safe conversion
        currency: 'NGN',
        status: 'PENDING',
        purpose,
        gateway: 'paystack',
        metadata
      });
    }

    const stableReference = payment.gatewayRef || payment._id.toString();
    if (!payment.gatewayRef) {
      payment.gatewayRef = stableReference;
    }

    if (!payment.authorizationUrl) {
      const paystackResponse = await paystackService.initializePayment({
        email: email || req.user.email,
        amount: payment.amount,
        reference: stableReference,
        callbackUrl,
        metadata: {
          ...metadata,
          paymentId: payment._id,
          userId,
          purpose,
        },
      });

      payment.gatewayRef = paystackResponse.reference || stableReference;
      payment.authorizationUrl = paystackResponse.authorization_url;
      payment.accessCode = paystackResponse.access_code;
      await payment.save();
    }

    logger.audit('Payment initialized', {
      requestId: req.requestId,
      userId,
      paymentId: payment._id,
      reference: payment.gatewayRef,
      amount: payment.amount,
      purpose: payment.purpose,
      reusedPendingPayment: reusedExistingPayment
    });

    res.json({
      success: true,
      data: {
        reference: payment.gatewayRef,
        authorization_url: payment.authorizationUrl,
        access_code: payment.accessCode,
        amount: payment.amount / 100 // Return in naira
      }
    });
  } catch (error) {
    console.error('Error initiating payment:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to initiate payment'
    });
  }
};

const initiateVerification = async (req, res) => {
  req.body = {
    amount: req.body?.amount || 1000,
    email: req.body?.email || req.user.email,
    callbackUrl: req.body?.callbackUrl || req.body?.callback_url,
    metadata: {
      ...(req.body?.metadata || {}),
      purpose: 'verify',
      userId: req.user.id
    }
  };
  return initiatePayment(req, res);
};

const initiateTopUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const amountInNaira = parseFloat(req.body.amount) || 100;

    // Validate amount with safe money utilities
    validateAmount(amountInNaira);
    const amountInKobo = nairaToKobo(amountInNaira);

    const payment = await Payment.create({
      userId,
      amount: amountInKobo,
      currency: 'NGN',
      status: 'PENDING',
      purpose: 'top_user',
      gateway: 'paystack',
      metadata: {
        userId
      }
    });

    const paystackResponse = await paystackService.initializePayment({
      email: req.user.email,
      amount: payment.amount,
      reference: payment._id.toString(),
      metadata: {
        paymentId: payment._id,
        userId,
        purpose: 'top_user'
      }
    });

    payment.gatewayRef = paystackResponse.reference;
    await payment.save();

    res.json({
      success: true,
      data: {
        checkoutUrl: paystackResponse.authorization_url,
        reference: payment.gatewayRef,
        amount: payment.amount / 100 // Return in naira
      }
    });
  } catch (error) {
    console.error('Error initiating top user payment:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to initiate top user payment'
    });
  }
};

// Verify payment
const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;

    const existingPayment = await resolvePaymentByReference(reference);
    if (!existingPayment) {
      logger.warn('Payment verification ignored unknown reference', {
        requestId: req.requestId,
        userId: req.user?.id,
        reference
      });
      return res.json({
        success: false,
        message: 'Payment reference was not found'
      });
    }

    if (existingPayment.userId.toString() !== req.user.id && req.user.userType !== 'admin') {
      return res.json({
        success: false,
        message: 'Unauthorized to verify this payment'
      });
    }

    if (existingPayment.status === 'PAID') {
      if (existingPayment.purpose === 'job_escrow' && existingPayment.metadata?.escrowId) {
        const escrow = await Escrow.findById(existingPayment.metadata.escrowId);
        if (escrow?.status === 'PENDING') {
          await handlePaymentSuccess(existingPayment, req.app);
        }
      }
      logger.audit('Payment verification replayed', {
        requestId: req.requestId,
        userId: req.user.id,
        paymentId: existingPayment._id,
        reference
      });
      return res.json({
        success: true,
        data: {
          status: 'success',
          amount: existingPayment.amount / 100,
          paidAt: existingPayment.verifiedAt || existingPayment.paidAt,
          purpose: existingPayment.purpose,
          metadata: existingPayment.metadata,
          jobId: existingPayment.metadata?.jobId,
          escrowId: existingPayment.metadata?.escrowId,
          user: await require('../models/User').findById(existingPayment.userId).select('-password')
        }
      });
    }

    // Verify with Paystack
    const verification = await paystackService.verifyPayment(reference);

    if (verification.status === 'success') {
      // Update payment status
      const payment = existingPayment;

      const claimedPayment = await Payment.findOneAndUpdate(
        { _id: payment._id, status: 'PENDING' },
        {
          $set: {
            status: 'PAID',
            paidAt: verification.paid_at ? new Date(verification.paid_at) : new Date(),
            verifiedAt: new Date(),
            gatewayResponse: verification
          }
        },
        { new: true }
      );

      if (claimedPayment) {
        await handlePaymentSuccess(claimedPayment, req.app);
        logger.audit('Payment verified', {
          requestId: req.requestId,
          userId: claimedPayment.userId,
          paymentId: claimedPayment._id,
          reference,
          amount: claimedPayment.amount,
          purpose: claimedPayment.purpose
        });
      }

      res.json({
        success: true,
        data: {
          status: 'success',
          amount: payment.amount / 100,
          paidAt: verification.paid_at,
          purpose: payment.purpose,
          metadata: payment.metadata,
          jobId: payment.metadata?.jobId,
          escrowId: payment.metadata?.escrowId,
          user: await require('../models/User').findById(payment.userId).select('-password')
        }
      });
    } else {
      // Update payment status to failed
      await Payment.findOneAndUpdate(
        { gatewayRef: reference },
        { status: 'FAILED', gatewayResponse: verification }
      );

      logger.warn('Payment verification failed', {
        requestId: req.requestId,
        userId: req.user?.id,
        reference,
        gatewayStatus: verification.status
      });

      res.json({
        success: false,
        message: 'Payment verification failed'
      });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.json({
      success: false,
      message: error.message || 'Failed to verify payment'
    });
  }
};

// Handle successful payment based on purpose
const handlePaymentSuccess = async (payment, app) => {
  try {
    const { purpose, metadata, subscriptionType } = payment;

    switch (purpose) {
      case 'job_escrow':
        // Fund escrow after payment verification
        if (!metadata?.escrowId) {
          throw new Error('Escrow ID is required for job escrow payment processing');
        }

        await escrowController.fundEscrowInternal({
          escrowId: metadata.escrowId,
          paymentReference: payment.gatewayRef || payment._id.toString(),
          payerId: payment.userId,
          app,
        });
        break;

      case 'boost':
        // Boost job
        await monetizationService.boostJob(metadata.userId, metadata.jobId);
        break;

      case 'verify':
        // Verify account
        await monetizationService.verifyAccount(metadata.userId);
        break;

      case 'feature':
        // Feature job
        await monetizationService.featureJob(metadata.userId, metadata.jobId);
        break;

      case 'subscription':
        // Subscribe to premium
        await monetizationService.subscribePremium(metadata.userId || payment.userId, metadata.plan || 'basic');
        break;

      case 'upgrade':
        // Activate AI subscription (monthly/yearly)
        if (subscriptionType) {
          await subscriptionService.activateSubscription(payment.userId, subscriptionType);
          // Mark subscription as activated in payment record
          await Payment.findByIdAndUpdate(payment._id, { subscriptionActivated: true });
        }
        break;

      case 'deposit':
        // Add to wallet
        await monetizationService.updateWalletBalance(
          payment.userId,
          payment.amount / 100, // Convert from kobo to naira
          'credit',
          'Wallet deposit',
          {
            paymentId: payment._id,
            paymentReference: payment.gatewayRef,
            purpose: payment.purpose
          }
        );
        break;

    default:
    }
  } catch (error) {
    console.error('Error handling payment success:', error);
    throw error;
  }
};

// Webhook handler for Paystack with enhanced security
const handleWebhook = async (req, res) => {
  try {
    // 1. Verify webhook signature (prevents tampering)
    const isValid = paystackService.verifyWebhook(req);
    if (!isValid) {
      logger.warn('Webhook rejected: invalid signature', {
        requestId: req.requestId,
        ip: req.ip
      });
      return res.status(401).send('Invalid signature');
    }

    const event = req.body;
    const eventType = event.event;
    const data = event.data;
    const reference = data?.reference;

    if (eventType === 'charge.success') {
      if (!reference) {
        logger.warn('charge.success webhook missing reference', {
          requestId: req.requestId,
          ip: req.ip
        });
        return res.status(400).send('Invalid charge.success data');
      }

      // 2. Secondary validation: Verify payment exists in our database BEFORE processing
      const payment = await resolvePaymentByReference(reference);
      if (!payment) {
        logger.warn('Webhook rejected: unknown payment reference', {
          requestId: req.requestId,
          reference
        });
        return res.status(404).send('Payment not found');
      }

      // 3. Replay-safe: fund escrow if payment already PAID but escrow still pending
      if (payment.status === 'PAID') {
        if (payment.purpose === 'job_escrow' && payment.metadata?.escrowId) {
          const escrow = await Escrow.findById(payment.metadata.escrowId);
          if (escrow?.status === 'PENDING') {
            try {
              await handlePaymentSuccess(payment, req.app);
            } catch (replayError) {
              console.error('Escrow replay funding failed:', replayError);
              return res.status(500).send('Escrow funding failed');
            }
          }
        }
        return res.status(200).send('ok');
      }

      // 4. Tertiary validation: Verify with Paystack API
      const verification = await paystackService.verifyWebhookWithPaystack(reference);
      if (!verification) {
        logger.warn('Webhook rejected: Paystack cross-check failed', {
          requestId: req.requestId,
          reference
        });
        return res.status(400).send('Verification with Paystack failed');
      }

      // 5. Amount validation - ensure webhook amount matches stored amount
      if (data.amount !== payment.amount) {
        logger.error('Webhook rejected: payment amount mismatch', {
          requestId: req.requestId,
          reference,
          webhookAmount: data.amount,
          storedAmount: payment.amount
        });
        return res.status(400).send('Amount mismatch');
      }

      // 6. Update payment and trigger downstream handlers
      const claimedPayment = await Payment.findOneAndUpdate(
        { _id: payment._id, status: 'PENDING' },
        {
          $set: {
            status: 'PAID',
            paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
            verifiedAt: new Date(),
            gatewayResponse: verification
          }
        },
        { new: true }
      );

      try {
        if (claimedPayment) {
          await handlePaymentSuccess(claimedPayment, req.app);
          logger.audit('Webhook payment processed', {
            requestId: req.requestId,
            paymentId: claimedPayment._id,
            userId: claimedPayment.userId,
            reference,
            amount: claimedPayment.amount,
            purpose: claimedPayment.purpose
          });
        }
      } catch (handlerError) {
        console.error('Error in payment success handler:', handlerError);
        return res.status(500).send('Handler failed');
      }

      return res.status(200).send('ok');
    }

    // Handle failed charges
    if (eventType === 'charge.failed') {
      const reference = data?.reference;
      if (reference) {
        const payment = await Payment.findOne({ gatewayRef: reference });
        if (payment && payment.status !== 'FAILED') {
          payment.status = 'FAILED';
          payment.gatewayResponse = data;
          await payment.save();
          logger.audit('Webhook payment failed', {
            requestId: req.requestId,
            paymentId: payment._id,
            userId: payment.userId,
            reference
          });
        }
      }
      return res.status(200).send('ok');
    }

    // Handle disputed charges
    if (eventType === 'charge.dispute.created') {
      const reference = data?.transaction?.reference;
      if (reference) {
        const payment = await Payment.findOne({ gatewayRef: reference });
        if (payment) {
          logger.warn('Payment disputed', { requestId: req.requestId, reference });
          // Could trigger notification/admin alert here
        }
      }
      return res.status(200).send('ok');
    }

    // Unknown event type - still return 200 to acknowledge receipt
    return res.status(200).send('ok');

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    // Return 500 to trigger Paystack retry, but don't expose error details
    return res.status(500).send('Internal server error');
  }
};

// Get payment history
const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    const payments = await Payment.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Payment.countDocuments({ userId });

    res.json({
      success: true,
      data: {
        payments: payments.map(p => ({
          id: p._id,
          amount: `$${(p.amount / 100).toFixed(2)}`,
          currency: p.currency,
          status: p.status,
          purpose: p.purpose,
          reference: p.gatewayRef,
          createdAt: p.createdAt,
          verifiedAt: p.verifiedAt
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error getting payment history:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get payment history'
    });
  }
};

module.exports = {
  initiatePayment,
  initiateVerification,
  verifyPayment,
  handleWebhook,
  getPaymentHistory,
  initiateTopUser
};
