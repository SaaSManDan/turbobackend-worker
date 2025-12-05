import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load integration specs and examples (NO internet fetching - all local files)
 */
export async function fetchIntegrationSpecs(authInfo, paymentInfo) {
  console.log(`[IntegrationSpecs] Loading specs...`);
  const specs = {};

  if (authInfo?.needsAuth) {
    specs.clerk = getClerkSpec() + '\n\n' + getClerkExamples();
    console.log(`[IntegrationSpecs] Clerk spec loaded`);
  }

  if (paymentInfo?.needsPayments) {
    specs.stripe = getStripeSpec() + '\n\n' + getStripeExamples();
    console.log(`[IntegrationSpecs] Stripe spec loaded`);
  }

  return specs;
}

/**
 * Get hardcoded Clerk specification summary
 */
function getClerkSpec() {
  return `
CLERK AUTHENTICATION SETUP:

1. Installation:
   npm install @clerk/clerk-sdk-node svix

2. Initialize SDK:
   import { clerkClient } from '@clerk/clerk-sdk-node';
   // SDK automatically uses CLERK_SECRET_KEY from env

3. Verify Session Token (Middleware Pattern):
   import { verifyToken } from '@clerk/clerk-sdk-node';

   export default defineEventHandler(async function(event) {
     const token = getHeader(event, 'Authorization')?.replace('Bearer ', '');
     try {
       const decoded = await verifyToken(token, {
         secretKey: process.env.CLERK_SECRET_KEY
       });
       event.context.userId = decoded.sub;
     } catch (error) {
       throw createError({ statusCode: 401, message: 'Unauthorized' });
     }
   });

4. Get User Info:
   const user = await clerkClient.users.getUser(userId);

5. Webhook Handler (REQUIRED):
   CRITICAL: You must create a Clerk webhook handler to sync users to the database upon signup.
   - Handle 'user.created' event to insert new users into database
   - Use Svix library to verify webhook signatures
   - Endpoint: POST /api/webhooks/clerk
   - See Example 4 in code examples below

6. Protected Endpoint Pattern:
   - Extract token from Authorization header
   - Verify with verifyToken()
   - Attach userId to request context
   - Use userId to fetch user-specific data

7. Common Endpoints:
   - GET /api/users/me (get current user)
   - POST /api/auth/verify (verify token)
   - POST /api/webhooks/clerk (REQUIRED - handle user signup)

8. Error Handling:
   - 401 for invalid/expired tokens
   - 403 for insufficient permissions
`;
}

/**
 * Load Clerk example files from local filesystem
 */
function getClerkExamples() {
  try {
    const examplesDir = join(__dirname, '../llms/prompts/integrationExamples/clerk');

    const authMiddleware = readFileSync(join(examplesDir, 'auth-middleware.example.js'), 'utf-8');
    const protectedEndpoint = readFileSync(join(examplesDir, 'protected-endpoint.example.js'), 'utf-8');
    const getUserInfo = readFileSync(join(examplesDir, 'get-user-info.example.js'), 'utf-8');
    const signupWebhook = readFileSync(join(examplesDir, 'signup-webhook-example.js'), 'utf-8');

    return `
=== CLERK CODE EXAMPLES ===

Example 1: Auth Middleware (server/middleware/auth.js)
\`\`\`javascript
${authMiddleware}
\`\`\`

Example 2: Protected Endpoint (server/api/profile/index.get.js)
\`\`\`javascript
${protectedEndpoint}
\`\`\`

Example 3: Get User Info (server/api/users/me.get.js)
\`\`\`javascript
${getUserInfo}
\`\`\`

Example 4: Clerk Signup Webhook (server/api/webhooks/clerk.post.js)
\`\`\`javascript
${signupWebhook}
\`\`\`

IMPORTANT: Follow these exact patterns when implementing Clerk authentication.
CRITICAL: Always create the Clerk signup webhook (Example 4) to sync users to the database immediately upon signup.
The webhook handles the 'user.created' event from Clerk to insert new users into your database when they register.
`;
  } catch (error) {
    console.error(`[IntegrationSpecs] Failed to load Clerk examples:`, error);
    return '\n(Clerk examples could not be loaded)';
  }
}

/**
 * Get hardcoded Stripe specification summary
 */
function getStripeSpec() {
  return `
STRIPE PAYMENT PROCESSING SETUP:

1. Installation:
   npm install stripe

2. Initialize SDK:
   import Stripe from 'stripe';
   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

3. Create Payment Intent:
   const paymentIntent = await stripe.paymentIntents.create({
     amount: 2000, // Amount in cents
     currency: 'usd',
     metadata: { orderId: '123' }
   });
   return { clientSecret: paymentIntent.client_secret };

4. Create Customer:
   const customer = await stripe.customers.create({
     email: 'customer@example.com',
     metadata: { userId: 'user_123' }
   });

5. Handle Webhooks (DEFAULT: Only payment_intent.succeeded):
   IMPORTANT: By default, ONLY handle payment_intent.succeeded events.
   Only add handlers for other event types if the user explicitly requests them.

   export default defineEventHandler(async function(event) {
     const body = await readRawBody(event);
     const sig = getHeader(event, 'stripe-signature');

     const webhookEvent = stripe.webhooks.constructEvent(
       body,
       sig,
       process.env.STRIPE_WEBHOOK_SECRET
     );

     // DEFAULT: Only handle successful payments
     if (webhookEvent.type === 'payment_intent.succeeded') {
       const paymentIntent = webhookEvent.data.object;
       console.log('Payment succeeded:', paymentIntent.id);
     }

     return { received: true };
   });

6. Common Endpoints:
   - POST /api/payments/create-intent (create payment intent)
   - POST /api/customers (create customer)
   - POST /api/webhooks/stripe (webhook handler)

7. Error Handling:
   - Wrap Stripe calls in try/catch
   - Return appropriate error messages
   - Log errors for debugging
`;
}

/**
 * Load Stripe example files from local filesystem
 */
function getStripeExamples() {
  try {
    const examplesDir = join(__dirname, '../llms/prompts/integrationExamples/stripe');

    const createPaymentIntent = readFileSync(join(examplesDir, 'create-payment-intent.example.js'), 'utf-8');
    const webhookHandler = readFileSync(join(examplesDir, 'webhook-handler.example.js'), 'utf-8');
    const createCustomer = readFileSync(join(examplesDir, 'create-customer.example.js'), 'utf-8');

    return `
=== STRIPE CODE EXAMPLES ===

Example 1: Create Payment Intent (server/api/payments/create-intent.post.js)
\`\`\`javascript
${createPaymentIntent}
\`\`\`

Example 2: Webhook Handler (server/api/webhooks/stripe.post.js)
IMPORTANT: By default, ONLY handle payment_intent.succeeded events.
\`\`\`javascript
${webhookHandler}
\`\`\`

Example 3: Create Customer (server/api/customers/index.post.js)
\`\`\`javascript
${createCustomer}
\`\`\`

IMPORTANT: Follow these exact patterns when implementing Stripe payments.
DEFAULT WEBHOOK BEHAVIOR: Only handle payment_intent.succeeded unless user explicitly requests other events.
`;
  } catch (error) {
    console.error(`[IntegrationSpecs] Failed to load Stripe examples:`, error);
    return '\n(Stripe examples could not be loaded)';
  }
}
