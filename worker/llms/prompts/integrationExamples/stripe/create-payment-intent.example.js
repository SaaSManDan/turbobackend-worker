import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default defineEventHandler(async function(event) {
  try {
    const { amount, currency = 'usd', description, metadata } = await readBody(event);

    // Validate amount
    if (!amount || amount < 50) {
      throw createError({
        statusCode: 400,
        message: 'Amount must be at least 50 cents'
      });
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount, // Amount in cents
      currency: currency,
      description: description || 'Payment',
      metadata: metadata || {},
      automatic_payment_methods: {
        enabled: true
      }
    });

    return {
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    };
  } catch (error) {
    console.error('Payment intent creation failed:', error);
    throw createError({
      statusCode: 500,
      message: `Payment failed: ${error.message}`
    });
  }
});
