import pool from '../../databases/postgresConnector.js';
import { syncCredentialsToFlyio } from '../handlers/flyioSecretsHandler.js';

/**
 * Processor for syncing credentials to Fly.io
 */
export default async function flyioSecretsSyncProcessor(job) {
    const { projectId, credentialName, credentialValue } = job.data;

    console.log(
        `[FlyioSecretsProcessor] Processing job for project: ${projectId}`,
    );
    console.log(`[FlyioSecretsProcessor] Credential Name: ${credentialName} | Credential Value: ${credentialValue}`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const result = await syncCredentialsToFlyio(
            projectId,
            credentialName,
            credentialValue,
            client,
        );

        if (result.success) {
            await client.query('COMMIT');
            console.log(
                `[FlyioSecretsProcessor] ✅ Job completed successfully`,
            );
            return { success: true };
        } else {
            await client.query('ROLLBACK');
            console.error(
                `[FlyioSecretsProcessor] Job failed: ${result.error}`,
            );
            throw new Error(result.error);
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[FlyioSecretsProcessor] Error:`, error);
        throw error;
    } finally {
        client.release();
    }
}
