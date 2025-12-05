import { callLLMNonStream } from "../llms/xai-non-stream.js";

/**
 * Detect if user's request requires authentication
 */
export async function detectAuthenticationNeed(userPrompt) {
  console.log(`[AuthDetector] Analyzing prompt for authentication need...`);

  const detectionPrompt = `Analyze this user request and determine if it requires user authentication.

User Request: "${userPrompt}"

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
}`;

  try {
    const result = await callLLMNonStream(detectionPrompt, null);
    const response = JSON.parse(result.text);

    console.log(`[AuthDetector] Needs authentication: ${response.needsAuth}`);
    console.log(`[AuthDetector] Reasoning: ${response.reasoning}`);

    return {
      needsAuth: response.needsAuth,
      reasoning: response.reasoning,
      authProvider: response.authProvider || 'clerk',
      usage: result.usage
    };
  } catch (error) {
    console.error(`[AuthDetector] Error detecting authentication need:`, error);
    // Default to false if detection fails
    return {
      needsAuth: false,
      reasoning: 'Detection failed, defaulting to no authentication',
      authProvider: 'clerk',
      usage: { inputTokens: 0, outputTokens: 0 }
    };
  }
}

/**
 * Detect if user's request requires payment processing
 */
export async function detectPaymentNeed(userPrompt) {
  console.log(`[PaymentDetector] Analyzing prompt for payment need...`);

  const detectionPrompt = `Analyze this user request and determine if it requires payment processing.

User Request: "${userPrompt}"

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
}`;

  try {
    const result = await callLLMNonStream(detectionPrompt, null);
    const response = JSON.parse(result.text);

    console.log(`[PaymentDetector] Needs payments: ${response.needsPayments}`);
    console.log(`[PaymentDetector] Reasoning: ${response.reasoning}`);

    return {
      needsPayments: response.needsPayments,
      reasoning: response.reasoning,
      paymentProvider: response.paymentProvider || 'stripe',
      usage: result.usage
    };
  } catch (error) {
    console.error(`[PaymentDetector] Error detecting payment need:`, error);
    // Default to false if detection fails
    return {
      needsPayments: false,
      reasoning: 'Detection failed, defaulting to no payments',
      paymentProvider: 'stripe',
      usage: { inputTokens: 0, outputTokens: 0 }
    };
  }
}
