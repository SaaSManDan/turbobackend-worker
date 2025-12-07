import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default defineEventHandler(async function(event) {
  try {
    // Get raw body and signature
    const body = await readRawBody(event);
    const sig = getHeader(event, 'stripe-signature');

    if (!sig) {
      throw createError({
        statusCode: 400,
        message: 'No signature header'
      });
    }

    // Verify webhook signature
    let webhookEvent;
    try {
      webhookEvent = stripe.webhooks.constructEvent(
        body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      throw createError({
        statusCode: 400,
        message: 'Invalid signature'
      });
    }

    // DEFAULT: Only handle payment success events
    // Add other event handlers only if user explicitly requests them
    if (webhookEvent.type === 'payment_intent.succeeded') {
      const paymentIntent = webhookEvent.data.object;
      console.log('Payment succeeded:', paymentIntent.id);

      // TODO: Update database to mark order as paid
      // TODO: Send confirmation email to customer
      // TODO: Trigger order fulfillment process
    }

    return { received: true };
  } catch (error) {
    console.error('Webhook error:', error);
    throw createError({
      statusCode: 400,
      message: `Webhook error: ${error.message}`
    });
  }
});
