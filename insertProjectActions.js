import 'dotenv/config';
import { nanoid } from 'nanoid';
import pool from './databases/postgresConnector.js';

async function insertProjectActions() {
  const client = await pool.connect();

  try {
    const projectId = 't9mpmjuljOinbwqkv5Zkq';
    const userId = 'user_34Ix3ZIfBb1V9yGdFxwPAG4ufZe';
    const currentTime = Math.floor(Date.now() / 1000);

    // Example actions with different types
    const actions = [
      {
        action_id: nanoid(),
        project_id: projectId,
        user_id: userId,
        request_id: nanoid(),
        action_type: 'database_query',
        action_details: 'Created users table with email and authentication fields',
        status: 'completed',
        environment: 'development',
        reference_ids: JSON.stringify({ table_name: 'users', query_id: nanoid() }),
        created_at: currentTime - 3600
      },
      {
        action_id: nanoid(),
        project_id: projectId,
        user_id: userId,
        request_id: nanoid(),
        action_type: 'github_push',
        action_details: 'Pushed initial project structure to main branch',
        status: 'completed',
        environment: 'development',
        reference_ids: JSON.stringify({ commit_sha: 'abc123def456', repo_name: 'my-project' }),
        created_at: currentTime - 2400
      },
      {
        action_id: nanoid(),
        project_id: projectId,
        user_id: userId,
        request_id: nanoid(),
        action_type: 'api_generation',
        action_details: 'Generated REST API endpoints for user management',
        status: 'completed',
        environment: 'development',
        reference_ids: JSON.stringify({ blueprint_id: nanoid(), endpoint_count: 5 }),
        created_at: currentTime - 1200
      },
      {
        action_id: nanoid(),
        project_id: projectId,
        user_id: userId,
        request_id: nanoid(),
        action_type: 'deployment',
        action_details: 'Deployed application to staging environment',
        status: 'in_progress',
        environment: 'staging',
        reference_ids: JSON.stringify({ deployment_id: nanoid(), platform: 'fly.io' }),
        created_at: currentTime
      }
    ];

    await client.query('BEGIN');

    for (const action of actions) {
      const query = `
        INSERT INTO ${process.env.PG_DB_SCHEMA}.project_actions 
        (action_id, project_id, user_id, request_id, action_type, action_details, status, environment, reference_ids, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `;
      
      await client.query(query, [
        action.action_id,
        action.project_id,
        action.user_id,
        action.request_id,
        action.action_type,
        action.action_details,
        action.status,
        action.environment,
        action.reference_ids,
        action.created_at
      ]);

      console.log(`✓ Inserted action: ${action.action_type} - ${action.action_details}`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Successfully inserted 4 project actions');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error inserting project actions:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

insertProjectActions();
