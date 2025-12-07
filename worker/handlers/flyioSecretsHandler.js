import pool from '../../databases/postgresConnector.js';
import {
    provisionDaytonaContainer,
    executeCommandInContainer,
    stopDaytonaContainer,
} from '../services/daytonaService.js';
import { nanoid } from 'nanoid';

/**
 * Sync credentials to Fly.io as encrypted secrets
 */
export async function syncCredentialsToFlyio(
    projectId,
    credentialName,
    credentialValue,
    client,
) {
    console.log(
        `[FlyioSecrets] Starting sync for project: ${projectId}, credential name: ${credentialName}`,
    );

    let containerId = null;

    try {
        // Get Fly.io app name from project_deployments table
        const deploymentResult = await client.query(
            `SELECT app_name FROM ${process.env.PG_DB_SCHEMA}.project_deployments 
             WHERE project_id = $1 AND platform = 'flyio' AND status = 'deployed'
             ORDER BY deployed_at DESC LIMIT 1`,
            [projectId],
        );

        if (deploymentResult.rows.length === 0) {
            console.log(
                `[FlyioSecrets] No Fly.io deployment found for project: ${projectId}`,
            );
            return {
                success: false,
                error: 'No Fly.io deployment found for this project',
            };
        }

        const appName = deploymentResult.rows[0].app_name;
        console.log(`[FlyioSecrets] Found Fly.io app: ${appName}`);

        // Spin up new Daytona container
        console.log(`[FlyioSecrets] Provisioning Daytona container...`);
        containerId = await provisionDaytonaContainer();
        console.log(`[FlyioSecrets] Container provisioned: ${containerId}`);

        // Install flyctl in container
        console.log(`[FlyioSecrets] Installing flyctl...`);
        await executeCommandInContainer(
            containerId,
            'curl -L https://fly.io/install.sh | sh',
        );
        console.log(`[FlyioSecrets] flyctl installed`);

        // Get Fly.io API token from .env
        const flyApiToken = process.env.FLY_API_TOKEN;
        if (!flyApiToken) {
            throw new Error('FLY_API_TOKEN not found in environment variables');
        }

        // Execute flyctl secrets set command
        console.log(
            `[FlyioSecrets] Setting secret ${credentialName} in app ${appName}...`,
        );
        const command = `export FLY_API_TOKEN="${flyApiToken}" && ~/.fly/bin/flyctl secrets set ${credentialName}="${credentialValue}" --app ${appName}`;

        const result = await executeCommandInContainer(containerId, command);

        if (result.exitCode !== 0) {
            throw new Error(
                `flyctl command failed: ${result.stderr || result.stdout}`,
            );
        }

        console.log(
            `[FlyioSecrets] ✅ Secret ${credentialName} set successfully`,
        );

        // Log to project_actions table
        const actionId = nanoid();
        const now = Math.floor(Date.now() / 1000);

        await client.query(
            `INSERT INTO ${process.env.PG_DB_SCHEMA}.project_actions
             (action_id, project_id, action_type, action_details, status, environment, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                actionId,
                projectId,
                'flyio-secret-sync',
                `Synced credential: ${credentialName}`,
                'success',
                'production',
                now,
            ],
        );

        return { success: true };
    } catch (error) {
        console.error(`[FlyioSecrets] Error syncing credentials:`, error);

        // Log failure to project_actions
        const actionId = nanoid();
        const now = Math.floor(Date.now() / 1000);

        await client.query(
            `INSERT INTO ${process.env.PG_DB_SCHEMA}.project_actions
             (action_id, project_id, action_type, action_details, status, environment, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                actionId,
                projectId,
                'flyio-secret-sync',
                `Failed to sync credential: ${credentialName} - ${error.message}`,
                'failed',
                'production',
                now,
            ],
        );

        return { success: false, error: error.message };
    } finally {
        // Tear down the container
        if (containerId) {
            console.log(
                `[FlyioSecrets] Tearing down container: ${containerId}`,
            );
            try {
                await stopDaytonaContainer(containerId);
                console.log(`[FlyioSecrets] Container stopped successfully`);
            } catch (error) {
                console.error(
                    `[FlyioSecrets] Error stopping container:`,
                    error,
                );
            }
        }
    }
}
