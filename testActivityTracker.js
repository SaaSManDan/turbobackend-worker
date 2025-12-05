import { trackActivity } from './worker/utils/activityTracker.js';
import pool from './databases/postgresConnector.js';

async function testActivityTracker() {
    console.log('Testing Activity Tracker...\n');

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Test 1: Track project creation
        console.log('Test 1: Tracking project creation...');
        const actionId1 = await trackActivity({
            projectId: 'test-project-123',
            userId: 'test-user-456',
            requestId: 'test-request-789',
            actionType: 'project_created',
            actionDetails: 'Project created with container abc123',
            status: 'success',
            environment: 'development',
            client,
        });
        console.log(`✅ Project creation tracked: ${actionId1}\n`);

        // Test 2: Track database creation
        console.log('Test 2: Tracking database creation...');
        const actionId2 = await trackActivity({
            projectId: 'test-project-123',
            userId: 'test-user-456',
            requestId: 'test-request-789',
            actionType: 'database_created',
            actionDetails:
                "Database 'turbobackend_proj_test' created with 3 tables: users, posts, comments",
            status: 'success',
            environment: 'development',
            client,
        });
        console.log(`✅ Database creation tracked: ${actionId2}\n`);

        // Test 3: Track endpoints added
        console.log('Test 3: Tracking endpoints added...');
        const actionId3 = await trackActivity({
            projectId: 'test-project-123',
            userId: 'test-user-456',
            requestId: 'test-request-789',
            actionType: 'endpoints_added',
            actionDetails: 'Added 2 endpoints: GET /api/users, POST /api/users',
            status: 'success',
            environment: 'development',
            client,
        });
        console.log(`✅ Endpoints added tracked: ${actionId3}\n`);

        // Test 4: Track deployment with reference IDs
        console.log('Test 4: Tracking deployment with reference IDs...');
        const actionId4 = await trackActivity({
            projectId: 'test-project-123',
            userId: 'test-user-456',
            requestId: 'test-request-789',
            actionType: 'deployment',
            actionDetails:
                'Deployed to fly.io: https://turbobackend-test.fly.dev',
            status: 'success',
            environment: 'production',
            referenceIds: {
                deployment_id: 'deploy_test_123',
                app_name: 'turbobackend-test',
            },
            client,
        });
        console.log(`✅ Deployment tracked: ${actionId4}\n`);

        // Test 5: Track GitHub push with reference IDs
        console.log('Test 5: Tracking GitHub push with reference IDs...');
        const actionId5 = await trackActivity({
            projectId: 'test-project-123',
            userId: 'test-user-456',
            requestId: 'test-request-789',
            actionType: 'github_push',
            actionDetails:
                'Pushed 5 files to https://github.com/user/turbobackend-test',
            status: 'success',
            environment: 'development',
            referenceIds: {
                github_push_id: 'push_test_456',
                commit_sha: 'abc123def456',
            },
            client,
        });
        console.log(`✅ GitHub push tracked: ${actionId5}\n`);

        // Query the tracked activities
        console.log('Querying tracked activities...');
        const result = await client.query(
            `SELECT * FROM ${process.env.PG_DB_SCHEMA}.project_actions 
       WHERE project_id = $1 
       ORDER BY created_at DESC`,
            ['test-project-123'],
        );

        console.log(`\nFound ${result.rows.length} activities:`);
        result.rows.forEach(function (row) {
            const refs = row.reference_ids
                ? ` [refs: ${JSON.stringify(row.reference_ids)}]`
                : '';
            console.log(
                `- ${row.action_type}: ${row.action_details} (${row.environment})${refs}`,
            );
        });

        // Rollback to clean up test data
        await client.query('ROLLBACK');
        console.log('\n✅ All tests passed! (Test data rolled back)');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n❌ Test failed:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

testActivityTracker();
