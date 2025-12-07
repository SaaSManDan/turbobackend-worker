import pool from '../databases/postgresConnector.js';
import { nanoid } from 'nanoid';

// Pricing per 1M tokens for different models
// Update these values based on current pricing
const PRICING = {
  'gemini-2.5-flash-lite': {
    inputPer1M: 0.075,  // $0.075 per 1M input tokens
    outputPer1M: 0.30   // $0.30 per 1M output tokens
  },
  'gemini-2.5-flash': {
    inputPer1M: 0.075,
    outputPer1M: 0.30
  },
  'grok-beta': {
    inputPer1M: 5.00,   // $5.00 per 1M input tokens (deprecated)
    outputPer1M: 15.00  // $15.00 per 1M output tokens (deprecated)
  },
  'grok-3': {
    inputPer1M: 5.00,   // $5.00 per 1M input tokens
    outputPer1M: 15.00  // $15.00 per 1M output tokens
  },
  'grok-4-fast': {
    inputPer1M: 0.20,   // $5.00 per 1M input tokens
    outputPer1M: 0.50  // $15.00 per 1M output tokens
  },
  'gpt-5-nano': {
    inputPer1M: 0.05,   // $0.05 per 1M input tokens
    outputPer1M: 0.40   // $0.40 per 1M output tokens
  }
};

/**
 * Calculate cost based on token usage and model
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @param {string} model - Model name
 * @returns {number} - Cost in dollars
 */
function calculateCost(inputTokens, outputTokens, model = 'gemini-2.5-flash-lite') {
  const pricing = PRICING[model];
  if (!pricing) {
    console.warn(`No pricing found for model: ${model}, defaulting to gemini-2.5-flash-lite`);
    const defaultPricing = PRICING['gemini-2.5-flash-lite'];
    const inputCost = (inputTokens / 1000000) * defaultPricing.inputPer1M;
    const outputCost = (outputTokens / 1000000) * defaultPricing.outputPer1M;
    return inputCost + outputCost;
  }

  const inputCost = (inputTokens / 1000000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1000000) * pricing.outputPer1M;
  return inputCost + outputCost;
}

/**
 * Track message cost and token usage in the database
 * @param {Object} params - Parameters object
 * @param {Object} params.usageMetadata - Usage metadata object with inputTokens and outputTokens
 * @param {number} params.usageMetadata.inputTokens - Number of input tokens used
 * @param {number} params.usageMetadata.outputTokens - Number of output tokens used
 * @param {string} params.projectId - Project ID
 * @param {string} params.jobId - Job ID
 * @param {string} params.userId - User ID
 * @param {string} params.promptContent - The prompt content
 * @param {string} params.messageType - Type of message (e.g., 'gemini-stream', 'openai-chat', 'xai-non-stream')
 * @param {string} params.model - Model name (e.g., 'grok-beta', 'gpt-5-nano', 'gemini-2.5-flash')
 * @returns {Promise<Object>} - Result object with message_id and cost
 */
async function trackMessageCost({
  usageMetadata,
  projectId,
  jobId,
  userId,
  promptContent,
  messageType,
  model,
  timeToCompletion,
  startedAt
}) {
  try {
    const messageId = nanoid();
    const tokenIn = usageMetadata.inputTokens || 0;
    const tokenOut = usageMetadata.outputTokens || 0;
    const cost = calculateCost(tokenIn, tokenOut, model);
    const completedAt = Math.floor(Date.now()/1000);

    const query = `
      INSERT INTO ${process.env.PG_DB_SCHEMA}.message_cost_tracker (
        message_id,
        project_id,
        job_id,
        user_id,
        prompt_content,
        message_type,
        model,
        input_tokens,
        output_tokens,
        cost_usd,
        time_to_completion,
        started_at,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;

    const values = [
      messageId,
      projectId,
      jobId,
      userId,
      promptContent,
      messageType,
      model,
      tokenIn,
      tokenOut,
      cost,
      timeToCompletion,
      startedAt,
      completedAt
    ];

    const result = await pool.query(query, values);

    console.log(`[trackMessageCost] Tracked message cost - ID: ${messageId}, Cost: $${cost.toFixed(6)}, Tokens In: ${tokenIn}, Tokens Out: ${tokenOut}`);

    return {
      messageId,
      cost,
      tokenIn,
      tokenOut,
      record: result.rows[0]
    };
  } catch (error) {
    console.error('[trackMessageCost] Error tracking message cost:', error);
    throw error;
  }
}

export { trackMessageCost, calculateCost };
