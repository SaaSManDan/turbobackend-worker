import { nanoid } from "nanoid";

/**
 * Store environment variable requirements in database
 */
export async function storeEnvVarRequirements(projectId, userId, requestId, authInfo, paymentInfo, client) {
  try {
    const actionId = nanoid();
    const now = Math.floor(Date.now() / 1000);

    const referenceIds = {
      clerk_required: authInfo?.needsAuth || false,
      stripe_required: paymentInfo?.needsPayments || false
    };

    let actionDetails = 'User must add environment variables: ';
    const requiredVars = [];

    if (authInfo?.needsAuth) {
      requiredVars.push('CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY');
    }

    if (paymentInfo?.needsPayments) {
      requiredVars.push('STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET');
    }

    actionDetails += requiredVars.join('; ');

    await client.query(
      `INSERT INTO ${process.env.PG_DB_SCHEMA}.project_actions
       (action_id, project_id, user_id, request_id, action_type, action_details, status, environment, reference_ids, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        actionId,
        projectId,
        userId,
        requestId,
        'env_vars_required',
        actionDetails,
        'pending',
        'development',
        JSON.stringify(referenceIds),
        now
      ]
    );

    console.log(`[EnvVarTracker] Stored env var requirements: ${actionId}`);
  } catch (error) {
    console.error(`[EnvVarTracker] Failed to store env var requirements:`, error);
    // Don't throw - this is not critical
  }
}
