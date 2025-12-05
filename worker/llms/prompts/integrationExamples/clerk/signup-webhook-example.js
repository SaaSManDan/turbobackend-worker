import pool from '../../../services/dbConnectors/postgresConnector';
import Stripe from 'stripe';
import { Webhook } from 'svix';
import { errorLogger } from '../../../utils/errorLogger';
import { sendEmail } from '../../../services/emailSender';

const stripeSecret = process.env.STRIPE_STANDARD_SECRET_KEY;

if (!stripeSecret) {
  throw new Error('Missing STRIPE_STANDARD_SECRET_KEY environment variable');
}

const stripe = new Stripe(stripeSecret);

export default eventHandler(async (event) => {
  const req = event.node.req
  const headers = getRequestHeaders(event);
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET

  if (!WEBHOOK_SECRET) {
    errorLogger(req.url, "Webhook secret key error", "stripe-webhook")
    throw new Error('Webhook secret key error')
  }

  // Get the headers
  const svix_id = headers['svix-id'];
  const svix_timestamp = headers['svix-timestamp']
  const svix_signature = headers['svix-signature']

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    errorLogger(req.url, "Error occured -- no svix headers")
    setResponseStatus(event, 400)
    return { message: 'Error occured -- no svix headers' }
  }

  // Get the raw body (needed for Svix signature verification)
  const payload = await readRawBody(event);

  if (!payload) {
    errorLogger(req.url, "Error occured -- empty payload")
    setResponseStatus(event, 400)
    return { message: 'Error occured -- empty payload' }
  }

  // Create a new Svix instance with your secret.
  const wh = new Webhook(WEBHOOK_SECRET)

  let evt;

  // Verify the payload with the headers
  try {
    evt = wh.verify(payload, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    })
  } catch (err) {
    errorLogger(req.nextUrl, err, "signup-webhook")
    setResponseStatus(event, 400)
    return { message: 'Error occured' }
  }

  const eventType = evt.type

  if (eventType === 'user.created') {
    console.log("User created event received" + JSON.stringify(evt, null, 2));
    const userId = evt.data.id;
    const userEmail = evt.data.email_addresses[0].email_address;

    try {
      // Create a new customer in Stripe
      const customer = await stripe.customers.create({
        email: userEmail,
      });

      const customerId = customer.id;

      console.log("Customer created in Stripe: " + JSON.stringify(customer, null, 2));


      const joinedAt = Math.floor(Date.now() / 1000);

      await pool.query(
          'INSERT INTO ' + process.env.PG_DB_SCHEMA + '.users(user_id, email, joined_at, payment_status, stripe_customer_id) VALUES ($1, $2, $3, $4, $5)',
          [userId, userEmail, joinedAt, 'trial', customerId]
        );

      await sendEmail("drodriguez.dcr@gmail.com", "New User Signed Up", "A new user has signed up!")

      setResponseStatus(event, 200)
      return { message: 'Success' }

    } catch (error) {
      errorLogger(req.url, error, "signup-webhook");
      console.error(error);
      setResponseStatus(event, 500)
      return { message: 'Internal Server Error' }
    }
  }

})
