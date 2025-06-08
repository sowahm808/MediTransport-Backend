const express = require('express');
const Stripe = require('stripe');
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Create payment intent
router.post('/create-intent', asyncHandler(async (req, res) => {
  const { rideId, amount } = req.body;
  const userId = req.user.id;

  if (!rideId || !amount) {
    throw new AppError('Ride ID and amount are required', 400);
  }

  // Verify ride belongs to user
  const rideResult = await query(
    'SELECT * FROM rides WHERE id = $1 AND user_id = $2',
    [rideId, userId]
  );

  if (rideResult.rows.length === 0) {
    throw new AppError('Ride not found', 404);
  }

  const ride = rideResult.rows[0];

  try {
    // Create payment intent with Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      metadata: {
        rideId: rideId.toString(),
        userId: userId
      }
    });

    // Create payment record in database
    await query(
      `INSERT INTO payments (ride_id, user_id, amount, method, status, stripe_payment_intent_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [rideId, userId, amount, 'credit_card', 'pending', paymentIntent.id]
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });

  } catch (error) {
    console.error('Stripe error:', error);
    throw new AppError('Failed to create payment intent', 500);
  }
}));

// Confirm payment
router.post('/confirm/:paymentIntentId', asyncHandler(async (req, res) => {
  const { paymentIntentId } = req.params;
  const userId = req.user.id;

  try {
    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.metadata.userId !== userId) {
      throw new AppError('Unauthorized access to payment', 403);
    }

    // Update payment status in database
    const updateResult = await query(
      `UPDATE payments
       SET status = $1, payment_date = NOW(), updated_at = NOW()
       WHERE stripe_payment_intent_id = $2 AND user_id = $3
       RETURNING *`,
      [paymentIntent.status === 'succeeded' ? 'completed' : 'failed', paymentIntentId, userId]
    );

    if (updateResult.rows.length === 0) {
      throw new AppError('Payment record not found', 404);
    }

    const payment = updateResult.rows[0];

    // If payment successful, update ride status
    if (paymentIntent.status === 'succeeded') {
      await query(
        'UPDATE rides SET status = $1, updated_at = NOW() WHERE id = $2',
        ['completed', payment.ride_id]
      );
    }

    res.json({
      message: 'Payment confirmed',
      payment: payment,
      stripeStatus: paymentIntent.status
    });

  } catch (error) {
    console.error('Payment confirmation error:', error);
    throw new AppError('Failed to confirm payment', 500);
  }
}));

// Get payment history
router.get('/history', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { limit = 20, offset = 0 } = req.query;

  const result = await query(
    `SELECT
      p.*,
      r.start_location,
      r.end_location,
      r.ride_date
    FROM payments p
    JOIN rides r ON p.ride_id = r.id
    WHERE p.user_id = $1
    ORDER BY p.created_at DESC
    LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  res.json({
    payments: result.rows,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      total: result.rows.length
    }
  });
}));

// Webhook endpoint for Stripe events
router.post('/webhook', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      await query(
        `UPDATE payments
         SET status = 'completed', payment_date = NOW()
         WHERE stripe_payment_intent_id = $1`,
        [paymentIntent.id]
      );
      break;

    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      await query(
        `UPDATE payments
         SET status = 'failed'
         WHERE stripe_payment_intent_id = $1`,
        [failedPayment.id]
      );
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
}));

module.exports = router;
