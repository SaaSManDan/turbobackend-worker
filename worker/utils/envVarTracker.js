import { nanoid } from "nanoid";

/**
 * Store placeholder credentials in cloud_credentials table
 */
export async function storeCredentialPlaceholders(projectId, authInfo, paymentInfo, client) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const credentials = [];

    // Add Clerk credentials if needed
    if (authInfo?.needsAuth) {
      credentials.push(
        { name: 'CLERK_SECRET_KEY', provider: 'clerk' },
        { name: 'CLERK_PUBLISHABLE_KEY', provider: 'clerk' },
        { name: 'CLERK_WEBHOOK_SECRET', provider: 'clerk' }
      );
    }

    // Add Stripe credentials if needed
    if (paymentInfo?.needsPayments) {
      credentials.push(
        { name: 'STRIPE_SECRET_KEY', provider: 'stripe' },
        { name: 'STRIPE_PUBLISHABLE_KEY', provider: 'stripe' },
        { name: 'STRIPE_WEBHOOK_SECRET', provider: 'stripe' }
      );
    }

    // Insert all credentials
    for (const cred of credentials) {
      const credentialId = nanoid();

      await client.query(
        `INSERT INTO ${process.env.PG_DB_SCHEMA}.cloud_credentials
         (credential_id, project_id, cloud_provider, credential_name, credential, default_region, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          credentialId,
          projectId,
          cred.provider,
          cred.name,
          null,  // credential value left NULL
          null,  // default_region left NULL
          false, // not active until user adds real values
          now,
          now
        ]
      );
    }

    console.log(`[CredentialTracker] Created ${credentials.length} placeholder credentials for project ${projectId}`);
  } catch (error) {
    console.error(`[CredentialTracker] Failed to store credential placeholders:`, error);
    // Don't throw - this is not critical
  }
}

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
