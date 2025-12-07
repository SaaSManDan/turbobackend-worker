import { nanoid } from 'nanoid';
import pool from '../../databases/postgresConnector.js';

/**
 * Track project activity/event
 * 
 * @param {Object} params - Activity tracking parameters
 * @param {string} params.projectId - Project ID
 * @param {string} params.userId - User ID
 * @param {string|null} params.requestId - Request ID (nullable)
 * @param {string} params.actionType - Type of action (e.g., 'project_created', 'endpoints_added')
 * @param {string} params.actionDetails - Human-readable description of the action
 * @param {string} params.status - Status of the action (default: 'success')
 * @param {string} params.environment - Environment (default: 'development')
 * @param {Object|null} params.referenceIds - JSONB object with reference IDs (e.g., {github_push_id: 'abc', deployment_id: 'xyz'})
 * @param {Object|null} params.client - Postgres client (optional, will create if not provided)
 * @returns {Promise<string>} - Returns the action_id
 */
export async function trackActivity({
    projectId,
    userId,
    requestId = null,
    actionType,
    actionDetails,
    status = 'success',
    environment = 'development',
    referenceIds = null,
    client = null,
}) {
    const shouldCloseClient = !client;
    if (!client) {
        client = await pool.connect();
    }

    try {
        const actionId = nanoid();
        const now = Math.floor(Date.now() / 1000);

        await client.query(
            `INSERT INTO ${process.env.PG_DB_SCHEMA}.project_actions 
       (action_id, project_id, user_id, request_id, action_type, action_details, status, environment, reference_ids, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                actionId,
                projectId,
                userId,
                requestId,
                actionType,
                actionDetails,
                status,
                environment,
                referenceIds ? JSON.stringify(referenceIds) : null,
                now,
            ],
        );

        console.log(
            `[ActivityTracker] Logged: ${actionType} for project ${projectId}`,
        );

        return actionId;
    } catch (error) {
        console.error(
            `[ActivityTracker] Error logging activity: ${error.message}`,
        );
        // Don't throw - activity tracking should never fail the main operation
        return null;
    } finally {
        if (shouldCloseClient) {
            client.release();
        }
    }
}
