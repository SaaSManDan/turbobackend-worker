import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default defineEventHandler(async function(event) {
  try {
    const { email, name, userId } = await readBody(event);

    if (!email) {
      throw createError({
        statusCode: 400,
        message: 'Email is required'
      });
    }

    // Create Stripe customer
    const customer = await stripe.customers.create({
      email: email,
      name: name,
      metadata: {
        userId: userId || event.context.userId || 'unknown'
      }
    });

    // TODO: Store customer.id in your database linked to user

    return {
      success: true,
      customerId: customer.id,
      email: customer.email
    };
  } catch (error) {
    console.error('Customer creation failed:', error);
    throw createError({
      statusCode: 500,
      message: `Failed to create customer: ${error.message}`
    });
  }
});
