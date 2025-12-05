# Feature 6: Auth & Payment Detection - Technical Implementation Plan

## Overview
Add intelligent authentication and payment detection to the initial project creation process. The system will analyze user prompts using AI to determine if authentication (Clerk) and/or payment processing (Stripe) should be added to the generated backend. The AI will have access to the latest Clerk and Stripe API specifications to properly implement these integrations.

## Architecture Flow

### Phase 0.3: Auth & Payment Detection (AFTER Database Detection, BEFORE Container)
**Location**: `worker/handlers/projectCreationExecutionHandler.js`

**Current Flow:**
1. Phase 0.5: Database Detection & Provisioning
2. Phase 1: Container Setup
3. Phase 2: Agentic Loop
4. Phase 3: Post-Execution

**New Flow:**
1. Phase 0.3: Auth & Payment Detection (NEW)
2. Phase 0.5: Database Detection & Provisioning
3. Phase 1: Container Setup (with auth/payment env var placeholders)
4. Phase 2: Agentic Loop (with Clerk/Stripe specs context)
5. Phase 3: Post-Execution

---

### Step 1: Authentication Need Detection
**Function**: `async function detectAuthenticationNeed(userPrompt)` (in `worker/utils/authPaymentDetector.js`)

**Purpose**: Determine if user wants authentication in their backend

**Input**: User's prompt string

**Process**:
- Calls AI (using existing `callLLMNonStream` from `worker/llms/xai-non-stream.js`)
- AI analyzes prompt for authentication-related keywords/intent

**Output**: JSON response
```json
{
  "needsAuth": true/false,
  "reasoning": "explanation of why auth is/isn't needed",
  "authProvider": "clerk"
}
```

**AI Prompt Template**:
```
Analyze this user request and determine if it requires user authentication.

User Request: "{userPrompt}"

Consider if the application needs to:
- User login/signup functionality
- User account management
- Protected routes or endpoints
- User-specific data access
- Session management
- Role-based access control

Return JSON only in this exact format:
{
  "needsAuth": true or false,
  "reasoning": "brief explanation",
  "authProvider": "clerk"
}
```

---

### Step 2: Payment Need Detection
**Function**: `async function detectPaymentNeed(userPrompt)` (in `worker/utils/authPaymentDetector.js`)

**Purpose**: Determine if user wants payment processing in their backend

**Input**: User's prompt string

**Process**:
- Calls AI (using existing `callLLMNonStream`)
- AI analyzes prompt for payment-related keywords/intent

**Output**: JSON response
```json
{
  "needsPayments": true/false,
  "reasoning": "explanation of why payments are/aren't needed",
  "paymentProvider": "stripe"
}
```

**AI Prompt Template**:
```
Analyze this user request and determine if it requires payment processing.

User Request: "{userPrompt}"

Consider if the application needs to:
- Accept customer payments
- Process credit/debit cards
- Handle subscriptions
- Manage billing
- Issue invoices
- Handle refunds

Return JSON only in this exact format:
{
  "needsPayments": true or false,
  "reasoning": "brief explanation",
  "paymentProvider": "stripe"
}
```

---

### Step 3: Env Var Placeholder Creation
**Function**: Part of `getOrProvisionContainer` modifications (in `worker/services/daytonaService.js`)

**Purpose**: Add environment variable placeholders for Clerk and Stripe so the AI knows what keys need to be configured

**Process**:
When creating `.env` file in container, conditionally add:

```javascript
// If authInfo exists
if (authInfo && authInfo.needsAuth) {
  await sandbox.process.executeCommand(
    `echo "\n# Clerk Authentication (REQUIRED - Add your keys)\nCLERK_SECRET_KEY=<YOUR_CLERK_SECRET_KEY>\nCLERK_PUBLISHABLE_KEY=<YOUR_CLERK_PUBLISHABLE_KEY>" >> .env`,
    projectDirPath
  );
}

// If paymentInfo exists
if (paymentInfo && paymentInfo.needsPayments) {
  await sandbox.process.executeCommand(
    `echo "\n# Stripe Payment Processing (REQUIRED - Add your keys)\nSTRIPE_SECRET_KEY=<YOUR_STRIPE_SECRET_KEY>\nSTRIPE_PUBLISHABLE_KEY=<YOUR_STRIPE_PUBLISHABLE_KEY>" >> .env`,
    projectDirPath
  );
}
```

**Output**: `.env` file in container with placeholder keys clearly marked as REQUIRED

---

### Step 4: AI Context Enhancement with Clerk/Stripe Specs
**Location**: `worker/llms/agenticLoopExecutor.js` and `worker/llms/prompts/containerAgentSystem.js`

**Purpose**: Provide AI with Clerk and Stripe specifications and working code examples so it can properly implement authentication and payment features

**Implementation**:

#### A. Load Integration Specs and Examples (Before Agentic Loop)
Create utility function: `async function fetchIntegrationSpecs(authInfo, paymentInfo)` (in `worker/utils/integrationSpecsFetcher.js`)

**IMPORTANT**: This function does NOT fetch from the internet. It loads:
1. Hardcoded specification summaries (curated documentation)
2. Local example files from `worker/llms/prompts/integrationExamples/`

```javascript
export async function fetchIntegrationSpecs(authInfo, paymentInfo) {
  const specs = {};

  if (authInfo?.needsAuth) {
    // Load hardcoded Clerk spec + local example files
    specs.clerk = getClerkSpec() + '\n\n' + getClerkExamples();
  }

  if (paymentInfo?.needsPayments) {
    // Load hardcoded Stripe spec + local example files
    specs.stripe = getStripeSpec() + '\n\n' + getStripeExamples();
  }

  return specs;
}

// Hardcoded spec (no network calls)
function getClerkSpec() {
  return `[Clerk documentation summary - see "Clerk Specs to Include" section below]`;
}

// Load local example files using readFileSync
function getClerkExamples() {
  const examplesDir = join(__dirname, '../llms/prompts/integrationExamples/clerk');
  const authMiddleware = readFileSync(join(examplesDir, 'auth-middleware.example.js'), 'utf-8');
  // ... etc
}
```

**What Gets Loaded:**

**Clerk Content:**
- Hardcoded spec summary with authentication patterns
- 3 local example files (auth middleware, protected endpoint, get user info)
- No internet fetching required

**Stripe Content:**
- Hardcoded spec summary with payment patterns
- 3 local example files (payment intent, webhook handler, create customer)
- No internet fetching required

**Why This Approach:**
- ✅ No network calls (100% reliable, no latency)
- ✅ Curated content (only relevant patterns)
- ✅ Version controlled (examples in codebase)
- ✅ Fast execution (instant loading)

#### B. Enhance System Prompt (in agenticLoopExecutor.js)

Add to system prompt after database schema section using template literals instead of string concatenation:

```javascript
if (integrationSpecs?.clerk) {
  console.log(`[AgenticLoop] Clerk authentication enabled`);
  systemPrompt += `

=== CLERK AUTHENTICATION INTEGRATION REQUESTED ===

You have Clerk authentication configured for this project.

Environment Variables (in .env):
- CLERK_SECRET_KEY (REQUIRED - user must add)
- CLERK_PUBLISHABLE_KEY (REQUIRED - user must add)

Clerk SDK Documentation:
${integrationSpecs.clerk}

INSTRUCTIONS:
- Install @clerk/clerk-sdk-node package
- Create authentication middleware using Clerk SDK
- Protect endpoints that require authentication
- Add user context to authenticated requests
- Handle authentication errors appropriately
- Add comments noting that CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY must be added to .env
`;
}

if (integrationSpecs?.stripe) {
  console.log(`[AgenticLoop] Stripe payments enabled`);
  systemPrompt += `

=== STRIPE PAYMENT INTEGRATION REQUESTED ===

You have Stripe payment processing configured for this project.

Environment Variables (in .env):
- STRIPE_SECRET_KEY (REQUIRED - user must add)
- STRIPE_PUBLISHABLE_KEY (REQUIRED - user must add)

Stripe SDK Documentation:
${integrationSpecs.stripe}

INSTRUCTIONS:
- Install stripe package
- Initialize Stripe client with secret key
- Implement payment intent creation endpoints
- Add webhook handler for payment events
- Handle payment errors appropriately
- Add comments noting that STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY must be added to .env
`;
}
```

---

### Step 5: User Notification About Required Env Vars
**Location**: `worker/handlers/projectCreationExecutionHandler.js` (success message)

**Purpose**: Inform user that they need to add Clerk/Stripe keys to test their backend

**Implementation**:
In the success message building section:

```javascript
if (authInfo?.needsAuth) {
  successParts.push(`\n⚠️  CLERK AUTHENTICATION: Add CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY to your .env file to enable authentication features.`);
}

if (paymentInfo?.needsPayments) {
  successParts.push(`\n⚠️  STRIPE PAYMENTS: Add STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY to your .env file to enable payment processing.`);
}
```

**Additional**: Store requirement in database

Create function: `async function storeEnvVarRequirements(projectId, authInfo, paymentInfo, client)` (in `worker/utils/envVarTracker.js`)

Store in `project_actions` table:
```javascript
await client.query(
  `INSERT INTO ${process.env.PG_DB_SCHEMA}.project_actions
   (action_id, project_id, user_id, request_id, action_type, action_details, status, environment, reference_ids, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
  [
    nanoid(),
    projectId,
    userId,
    requestId,
    'env_vars_required',
    'User must add Clerk and/or Stripe environment variables',
    'pending',
    'development',
    JSON.stringify({
      clerk_required: authInfo?.needsAuth || false,
      stripe_required: paymentInfo?.needsPayments || false
    }),
    Math.floor(Date.now() / 1000)
  ]
);
```

---

## Integration Points

### 1. Modify `projectCreationExecutionHandler.js`

Add auth/payment detection BEFORE database detection:

```javascript
export async function handleProjectCreationOrchestration(job, requestId, streamId) {
  const { user_id, project_id, request_params } = job.data;
  const { userPrompt } = request_params;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await publishProgress(streamId, "Starting execution...", 10);

    // NEW: Phase 0.3 - Auth & Payment Detection
    let authInfo = null;
    let paymentInfo = null;
    let authDetectionCost = 0;
    let paymentDetectionCost = 0;

    console.log(`[AgenticExecution] Phase 0.3: Detecting auth & payment requirements`);

    const authResult = await detectAuthenticationNeed(userPrompt);
    authDetectionCost = calculateCost(authResult.usage.inputTokens, authResult.usage.outputTokens, 'grok-2-1212');

    if (authResult.needsAuth) {
      authInfo = authResult;
      await publishProgress(streamId, "Authentication required - Clerk will be configured", 8);
      console.log(`[AgenticExecution] ✅ Auth required: ${authResult.reasoning}`);
    }

    const paymentResult = await detectPaymentNeed(userPrompt);
    paymentDetectionCost = calculateCost(paymentResult.usage.inputTokens, paymentResult.usage.outputTokens, 'grok-2-1212');

    if (paymentResult.needsPayments) {
      paymentInfo = paymentResult;
      await publishProgress(streamId, "Payment processing required - Stripe will be configured", 9);
      console.log(`[AgenticExecution] ✅ Payments required: ${paymentResult.reasoning}`);
    }

    // Phase 0.5: Database Detection & Provisioning
    let databaseInfo = null;
    // ... existing database detection code ...

    // Phase 1: Container Setup (pass authInfo and paymentInfo)
    const containerId = await getOrProvisionContainer(project_id, client, databaseInfo, authInfo, paymentInfo);
    await publishProgress(streamId, "Container provisioned", 20);

    // Load integration specs and examples if needed
    let integrationSpecs = null;
    if (authInfo || paymentInfo) {
      await publishProgress(streamId, "Loading integration specifications...", 25);
      integrationSpecs = await fetchIntegrationSpecs(authInfo, paymentInfo);
      // Note: This loads hardcoded specs + local example files (no network calls)
      await publishProgress(streamId, "Integration specs loaded", 28);
    }

    // Phase 2: Agentic Loop (pass integrationSpecs)
    const agentResult = await runAgenticLoop({
      containerId,
      projectId: project_id,
      userId: user_id,
      userRequest: userPrompt,
      requestId,
      databaseSchema: databaseInfo?.schema || null,
      integrationSpecs: integrationSpecs || null
    });

    // Phase 3: Post-Execution
    // ... existing code ...

    // Store env var requirements if auth or payments configured
    if (authInfo || paymentInfo) {
      await storeEnvVarRequirements(project_id, user_id, requestId, authInfo, paymentInfo, client);
    }

    await client.query('COMMIT');

    // Build success message (add auth/payment warnings)
    const successParts = [];
    successParts.push(`Project execution completed successfully!`);
    successParts.push(`\nFiles modified: ${agentResult.filesModified?.length || 0}`);

    if (authInfo?.needsAuth) {
      successParts.push(`\n⚠️  CLERK AUTHENTICATION: Add CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY to your .env file.`);
    }

    if (paymentInfo?.needsPayments) {
      successParts.push(`\n⚠️  STRIPE PAYMENTS: Add STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY to your .env file.`);
    }

    // ... rest of success message ...

    const totalCost = (agentResult.totalCost || 0) + dbDetectionCost + dbDesignCost + authDetectionCost + paymentDetectionCost;
    successParts.push(`\nTotal cost: $${totalCost.toFixed(4)}`);

    await publishSuccess(streamId, successParts.join('\n'));

    return {
      success: true,
      requestId,
      containerId,
      authInfo,
      paymentInfo,
      databaseInfo,
      // ... rest of return ...
    };
  }
}
```

---

### 2. Modify `daytonaService.js`

Update `getOrProvisionContainer` signature:
```javascript
export async function getOrProvisionContainer(projectId, client, databaseInfo, authInfo = null, paymentInfo = null)
```

Add env var placeholders when creating `.env` file (after database env vars):
```javascript
// ... existing database env vars code ...

// Add auth env vars if needed
if (authInfo && authInfo.needsAuth) {
  await sandbox.process.executeCommand(
    `echo "\n# Clerk Authentication (REQUIRED - Add your keys)\nCLERK_SECRET_KEY=<YOUR_CLERK_SECRET_KEY>\nCLERK_PUBLISHABLE_KEY=<YOUR_CLERK_PUBLISHABLE_KEY>" >> .env`,
    projectDirPath
  );
  console.log(`[Daytona] Added Clerk env var placeholders`);
}

// Add payment env vars if needed
if (paymentInfo && paymentInfo.needsPayments) {
  await sandbox.process.executeCommand(
    `echo "\n# Stripe Payment Processing (REQUIRED - Add your keys)\nSTRIPE_SECRET_KEY=<YOUR_STRIPE_SECRET_KEY>\nSTRIPE_PUBLISHABLE_KEY=<YOUR_STRIPE_PUBLISHABLE_KEY>\nSTRIPE_WEBHOOK_SECRET=<YOUR_STRIPE_WEBHOOK_SECRET>" >> .env`,
    projectDirPath
  );
  console.log(`[Daytona] Added Stripe env var placeholders`);
}
```

---

### 3. Modify `agenticLoopExecutor.js`

Update `runAgenticLoop` signature:
```javascript
export async function runAgenticLoop({
  containerId,
  projectId,
  userId,
  userRequest,
  requestId,
  databaseSchema = null,
  integrationSpecs = null, // NEW
  existingFiles = [],
  existingEndpoints = [],
  projectName = null,
  maxIterations = Infinity
})
```

Add integration specs to system prompt (after database section) using template literals:
```javascript
// ... existing database prompt code ...

// Add Clerk auth specs
if (integrationSpecs?.clerk) {
  console.log(`[AgenticLoop] Clerk authentication enabled`);
  systemPrompt += `

=== CLERK AUTHENTICATION AVAILABLE ===

You have Clerk authentication configured.

Environment Variables (in .env):
- CLERK_SECRET_KEY (REQUIRED - user must add)
- CLERK_PUBLISHABLE_KEY (REQUIRED - user must add)

${integrationSpecs.clerk}

INSTRUCTIONS:
- Install @clerk/clerk-sdk-node
- Create auth middleware with Clerk SDK
- Protect endpoints requiring authentication
- Add comments about required env vars
`;
}

// Add Stripe payment specs
if (integrationSpecs?.stripe) {
  console.log(`[AgenticLoop] Stripe payments enabled`);
  systemPrompt += `

=== STRIPE PAYMENT PROCESSING AVAILABLE ===

You have Stripe payment processing configured.

Environment Variables (in .env):
- STRIPE_SECRET_KEY (REQUIRED - user must add)
- STRIPE_PUBLISHABLE_KEY (REQUIRED - user must add)
- STRIPE_WEBHOOK_SECRET (REQUIRED for webhooks)

${integrationSpecs.stripe}

INSTRUCTIONS:
- Install stripe package
- Initialize Stripe with secret key
- Implement payment intent endpoints
- Add webhook handler for payment events
- CRITICAL: Webhook handler should ONLY handle payment_intent.succeeded by default
- Only add other webhook event handlers (payment_failed, customer.created, etc.) if user explicitly requests them
- Add comments about required env vars
- Follow the exact patterns shown in the examples above
`;
}
```

---

## Integration Examples Directory Structure

Create a dedicated directory for integration code examples that the AI will use as templates:

```
worker/
├── llms/
│   └── prompts/
│       ├── containerAgentSystem.js
│       └── integrationExamples/          ← NEW DIRECTORY
│           ├── clerk/
│           │   ├── auth-middleware.example.js
│           │   ├── protected-endpoint.example.js
│           │   └── get-user-info.example.js
│           └── stripe/
│               ├── create-payment-intent.example.js
│               ├── webhook-handler.example.js
│               └── create-customer.example.js
```

### Why This Approach?

1. **Few-Shot Learning**: Research shows LLMs generate better code with 2-3 concrete examples
2. **Co-located with Prompts**: Lives near `containerAgentSystem.js` where it's used
3. **Version Controlled**: Examples are reviewable, testable, and maintainable
4. **Project-Specific Patterns**: Shows Nitro.js conventions (defineEventHandler, etc.)

---

## Clerk & Stripe Specifications

### Clerk Specs to Include (from https://clerk.com/docs/reference/backend-api)

**Summary Format:**
```
CLERK AUTHENTICATION SETUP:

1. Installation:
   npm install @clerk/clerk-sdk-node

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
       // Continue with authenticated request
     } catch (error) {
       throw createError({ statusCode: 401, message: 'Unauthorized' });
     }
   });

4. Get User Info:
   const user = await clerkClient.users.getUser(userId);

5. Protected Endpoint Pattern:
   - Extract token from Authorization header
   - Verify with verifyToken()
   - Attach userId to request context
   - Use userId to fetch user-specific data

6. Common Endpoints:
   - GET /api/users/me (get current user)
   - POST /api/auth/verify (verify token)

7. Error Handling:
   - 401 for invalid/expired tokens
   - 403 for insufficient permissions
```

### Stripe Specs to Include (from https://docs.stripe.com/api)

**Summary Format:**
```
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
       // Handle successful payment
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
```

---

## Database Schema Updates

**No new tables needed.** Use existing:
- `project_actions` - Store env var requirements with `action_type = 'env_vars_required'`
- `mcp_requests` - Track auth/payment detection requests
- `message_cost_tracker` - Track AI costs for detection

---

## Example Files Content

### Clerk Example Files

#### `worker/llms/prompts/integrationExamples/clerk/auth-middleware.example.js`
```javascript
import { verifyToken } from '@clerk/clerk-sdk-node';

export default defineEventHandler(async function(event) {
  // Skip auth for public routes
  if (event.path.startsWith('/api/public')) {
    return;
  }

  const authHeader = getHeader(event, 'Authorization');
  if (!authHeader) {
    throw createError({
      statusCode: 401,
      message: 'No authorization header'
    });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const decoded = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY
    });

    // Attach user ID to request context
    event.context.userId = decoded.sub;
    event.context.user = decoded;
  } catch (error) {
    throw createError({
      statusCode: 401,
      message: 'Invalid or expired token'
    });
  }
});
```

#### `worker/llms/prompts/integrationExamples/clerk/protected-endpoint.example.js`
```javascript
import { clerkClient } from '@clerk/clerk-sdk-node';

export default defineEventHandler(async function(event) {
  // User ID is available from auth middleware
  const userId = event.context.userId;

  if (!userId) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized - no user ID in context'
    });
  }

  try {
    // Fetch full user details from Clerk
    const user = await clerkClient.users.getUser(userId);

    return {
      success: true,
      user: {
        id: user.id,
        email: user.emailAddresses[0]?.emailAddress,
        firstName: user.firstName,
        lastName: user.lastName,
        createdAt: user.createdAt
      }
    };
  } catch (error) {
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch user profile'
    });
  }
});
```

#### `worker/llms/prompts/integrationExamples/clerk/get-user-info.example.js`
```javascript
import { clerkClient } from '@clerk/clerk-sdk-node';

export default defineEventHandler(async function(event) {
  const userId = event.context.userId;

  if (!userId) {
    throw createError({ statusCode: 401, message: 'Unauthorized' });
  }

  try {
    const user = await clerkClient.users.getUser(userId);

    return {
      success: true,
      user: {
        id: user.id,
        email: user.emailAddresses[0]?.emailAddress,
        firstName: user.firstName,
        lastName: user.lastName
      }
    };
  } catch (error) {
    throw createError({
      statusCode: 500,
      message: 'Failed to get user info'
    });
  }
});
```

### Stripe Example Files

#### `worker/llms/prompts/integrationExamples/stripe/create-payment-intent.example.js`
```javascript
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
```

#### `worker/llms/prompts/integrationExamples/stripe/webhook-handler.example.js`
```javascript
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
```

#### `worker/llms/prompts/integrationExamples/stripe/create-customer.example.js`
```javascript
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
```

---

## Files to Create

**IMPORTANT NOTE**: The `fetchIntegrationSpecs()` function is named "fetch" for consistency with existing patterns, but it does NOT fetch from the internet. It loads:
1. Hardcoded spec summaries (inline in the code)
2. Local example files using `readFileSync()`

No network calls are made. All content is stored locally in the codebase.

---

### New Files:

1. **`worker/utils/authPaymentDetector.js`**
   - `detectAuthenticationNeed(userPrompt)` - Detect if auth is needed
   - `detectPaymentNeed(userPrompt)` - Detect if payments are needed

2. **`worker/utils/integrationSpecsFetcher.js`**
   - `fetchIntegrationSpecs(authInfo, paymentInfo)` - Fetch Clerk/Stripe specs and examples
   - `getClerkSpec()` - Get Clerk documentation summary
   - `getStripeSpec()` - Get Stripe documentation summary
   - `getClerkExamples()` - Load Clerk example files
   - `getStripeExamples()` - Load Stripe example files

   **Implementation Pattern:**
   ```javascript
   import { readFileSync } from 'fs';
   import { fileURLToPath } from 'url';
   import { dirname, join } from 'path';

   const __filename = fileURLToPath(import.meta.url);
   const __dirname = dirname(__filename);

   export async function fetchIntegrationSpecs(authInfo, paymentInfo) {
     console.log(`[IntegrationSpecs] Fetching specs...`);
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

   function getClerkExamples() {
     const examplesDir = join(__dirname, '../llms/prompts/integrationExamples/clerk');

     const authMiddleware = readFileSync(join(examplesDir, 'auth-middleware.example.js'), 'utf-8');
     const protectedEndpoint = readFileSync(join(examplesDir, 'protected-endpoint.example.js'), 'utf-8');
     const getUserInfo = readFileSync(join(examplesDir, 'get-user-info.example.js'), 'utf-8');

     return `
   === CLERK CODE EXAMPLES ===

   Example 1: Auth Middleware (server/middleware/auth.js)
   ${authMiddleware}

   Example 2: Protected Endpoint (server/api/profile/index.get.js)
   ${protectedEndpoint}

   Example 3: Get User Info (server/api/users/me.get.js)
   ${getUserInfo}

   IMPORTANT: Follow these exact patterns when implementing Clerk authentication.
   `;
   }

   function getStripeExamples() {
     const examplesDir = join(__dirname, '../llms/prompts/integrationExamples/stripe');

     const createPaymentIntent = readFileSync(join(examplesDir, 'create-payment-intent.example.js'), 'utf-8');
     const webhookHandler = readFileSync(join(examplesDir, 'webhook-handler.example.js'), 'utf-8');
     const createCustomer = readFileSync(join(examplesDir, 'create-customer.example.js'), 'utf-8');

     return `
   === STRIPE CODE EXAMPLES ===

   Example 1: Create Payment Intent (server/api/payments/create-intent.post.js)
   ${createPaymentIntent}

   Example 2: Webhook Handler (server/api/webhooks/stripe.post.js)
   IMPORTANT: By default, ONLY handle payment_intent.succeeded events.
   ${webhookHandler}

   Example 3: Create Customer (server/api/customers/index.post.js)
   ${createCustomer}

   IMPORTANT: Follow these exact patterns when implementing Stripe payments.
   DEFAULT WEBHOOK BEHAVIOR: Only handle payment_intent.succeeded unless user explicitly requests other events.
   `;
   }
   ```

3. **`worker/utils/envVarTracker.js`**
   - `storeEnvVarRequirements(projectId, userId, requestId, authInfo, paymentInfo, client)` - Store env var requirements in DB

4. **Example Files Directory: `worker/llms/prompts/integrationExamples/`**
   - `clerk/auth-middleware.example.js` - Auth middleware pattern
   - `clerk/protected-endpoint.example.js` - Protected endpoint pattern
   - `clerk/get-user-info.example.js` - Get user info pattern
   - `stripe/create-payment-intent.example.js` - Payment intent creation
   - `stripe/webhook-handler.example.js` - Webhook handler (payment_intent.succeeded only)
   - `stripe/create-customer.example.js` - Customer creation

---

## Files to Modify

### Modified Files:

1. **`worker/handlers/projectCreationExecutionHandler.js`**
   - Add Phase 0.3 (auth/payment detection)
   - Pass authInfo and paymentInfo to container setup
   - Fetch integration specs before agentic loop
   - Pass integrationSpecs to runAgenticLoop
   - Add env var warnings to success message
   - Track auth/payment detection costs

2. **`worker/services/daytonaService.js`**
   - Update `getOrProvisionContainer` signature to accept authInfo and paymentInfo
   - Add Clerk env var placeholders if authInfo exists
   - Add Stripe env var placeholders if paymentInfo exists

3. **`worker/llms/agenticLoopExecutor.js`**
   - Update `runAgenticLoop` signature to accept integrationSpecs
   - Add Clerk specs section to system prompt when authInfo exists
   - Add Stripe specs section to system prompt when paymentInfo exists

---

## Environment Variables

**All existing** - no new env vars needed:
- All AI calls use existing xAI configuration
- Clerk/Stripe specs are fetched from public documentation URLs

---

## Cost Tracking

Track AI calls using existing `calculateCost` utility:
- Auth detection: ~100-200 tokens input, ~50 tokens output
- Payment detection: ~100-200 tokens input, ~50 tokens output
- Total additional cost per project: ~$0.0001-0.0002

Add to overall request cost in `handleProjectCreationOrchestration`:
```javascript
const totalCost = (agentResult.totalCost || 0) +
                  dbDetectionCost +
                  dbDesignCost +
                  authDetectionCost +
                  paymentDetectionCost;
```

---

## Error Handling

### Auth/Payment Detection Failures:
- If AI detection fails, log warning and default to `needsAuth: false` and `needsPayments: false`
- Continue project creation without auth/payment features
- Don't block project creation on detection failure

### Integration Specs Loading Failures:
- If Clerk example files fail to load (missing files, read errors), use spec summary only
- If Stripe example files fail to load (missing files, read errors), use spec summary only
- Log error but continue with available information
- Since specs are hardcoded (no network calls), failures are limited to file system issues

### All wrapped in try/catch with proper logging:
```javascript
try {
  const authResult = await detectAuthenticationNeed(userPrompt);
  // ... process result ...
} catch (error) {
  console.error(`[AuthDetection] Failed: ${error.message}`);
  authInfo = { needsAuth: false, reasoning: 'Detection failed' };
}
```

---

## Testing Scenarios

### Test Case 1: User wants auth
**Prompt**: "Build a blog API with user authentication"
**Expected**:
- `needsAuth: true`
- `needsPayments: false`
- `.env` has Clerk placeholders
- AI receives Clerk specs
- Code includes @clerk/clerk-sdk-node
- Success message warns about Clerk keys

### Test Case 2: User wants payments
**Prompt**: "Create an e-commerce API with payment processing"
**Expected**:
- `needsAuth: false` (not explicitly mentioned)
- `needsPayments: true`
- `.env` has Stripe placeholders (including STRIPE_WEBHOOK_SECRET)
- AI receives Stripe specs and examples
- Code includes stripe package
- Webhook handler ONLY handles payment_intent.succeeded
- Success message warns about Stripe keys

### Test Case 3: User wants both
**Prompt**: "Build a SaaS API with user accounts and subscription billing"
**Expected**:
- `needsAuth: true`
- `needsPayments: true`
- `.env` has both Clerk and Stripe placeholders (all keys including STRIPE_WEBHOOK_SECRET)
- AI receives both specs with code examples
- Code includes both packages
- Auth middleware created
- Webhook handler ONLY handles payment_intent.succeeded by default
- Success message warns about both keys

### Test Case 4: User wants neither
**Prompt**: "Create a weather API that fetches data from external source"
**Expected**:
- `needsAuth: false`
- `needsPayments: false`
- `.env` has no auth/payment placeholders
- AI receives no integration specs
- Normal project creation flow

---

## Performance Considerations

### Additional Latency:
- Auth detection: ~0.5-1 second (AI call)
- Payment detection: ~0.5-1 second (AI call)
- Specs loading: ~0.01-0.05 second (local file reads only, no network)
- **Total additional time**: ~1-2 seconds

### Optimization:
- Run auth and payment detection in parallel (when possible)
- Specs loading is instant (readFileSync from local files, no network latency)
- No caching needed since loading is already instantaneous
- Use minimal, curated specs (not full documentation)

### Progress Updates:
```javascript
await publishProgress(streamId, "Analyzing authentication needs...", 5);
await publishProgress(streamId, "Analyzing payment requirements...", 7);
await publishProgress(streamId, "Auth & payment configured", 9);
```

---

## Success Criteria

✅ User prompts mentioning "authentication", "login", "user accounts" trigger auth detection
✅ User prompts mentioning "payments", "billing", "subscriptions" trigger payment detection
✅ Generated code includes proper Clerk SDK usage when auth detected
✅ Generated code includes proper Stripe SDK usage when payments detected
✅ `.env` file contains placeholder keys with clear REQUIRED labels
✅ Success message warns users about needed env vars
✅ AI generates working auth/payment endpoints
✅ Total additional cost < $0.001 per project
✅ Additional latency < 3 seconds

---

## Implementation Priority

### Phase 1:
1. Auth/payment detection functions
2. Integration specs fetcher with hardcoded summaries
3. Env var placeholder injection
4. System prompt enhancement
5. Success message warnings

### Phase 2 (Polish - If Time Permits):
6. Env var requirements storage in DB
7. Progress updates for detection steps
8. Error handling and fallbacks
9. Cost tracking integration

---

## Summary of Key Changes

### 1. **Integration Examples Directory (NEW)**
- Created `worker/llms/prompts/integrationExamples/` with 6 example files
- 3 Clerk examples: auth middleware, protected endpoint, get user info
- 3 Stripe examples: payment intent, webhook handler, create customer
- Examples use few-shot learning to guide AI code generation

### 2. **Stripe Webhook Default Behavior (CRITICAL)**
- **DEFAULT**: Webhook handler ONLY processes `payment_intent.succeeded` events
- Other event types (`payment_intent.payment_failed`, `customer.created`, etc.) are NOT added unless user explicitly requests them
- This is emphasized in:
  - Example file comments
  - Stripe spec documentation
  - System prompt instructions
  - Test case expectations

### 3. **Environment Variables Updated**
- Added `STRIPE_WEBHOOK_SECRET` to env var placeholders
- All three Stripe keys now included: SECRET, PUBLISHABLE, WEBHOOK_SECRET

### 4. **Implementation Approach - Local Files Only**
- Using **Approach 1**: Dedicated examples directory with `readFileSync()`
- **NO internet fetching** - all specs and examples are local files
- Hardcoded specification summaries (curated documentation)
- Local example files loaded from `worker/llms/prompts/integrationExamples/`
- Provides better maintainability and version control
- Examples are co-located with prompts for easy discovery
- Clear separation between specs (documentation) and examples (code)

### 5. **Files to Create**
- 6 new example files (3 Clerk + 3 Stripe) - stored locally
- `integrationSpecsFetcher.js` with:
  - Hardcoded `getClerkSpec()` and `getStripeSpec()` functions (no network calls)
  - `getClerkExamples()` and `getStripeExamples()` functions (readFileSync only)
- `authPaymentDetector.js` for AI detection
- `envVarTracker.js` for DB storage

### 6. **AI Prompt Enhancements**
- System prompt includes both specs (hardcoded summaries) AND working code examples (local files)
- Clear instructions about webhook default behavior
- Emphasis on following exact patterns from examples
- All content loaded instantly from local files (no network latency)

