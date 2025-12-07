import { nanoid } from "nanoid";
import pg from "pg";
import { trackActivity } from "./activityTracker.js";
const { Pool } = pg;

/**
 * Execute generated queries in dev environment database
 */
export async function executeDevDatabaseQueries(projectId, queries, client, userId = null, requestId = null) {
  console.log(`[DevDB] Executing ${queries.length} queries for project ${projectId}`);
  
  // Check if project has a database
  const projectDbResult = await client.query(
    `SELECT * FROM ${process.env.PG_DB_SCHEMA}.project_databases 
     WHERE project_id = $1 AND is_active = true`,
    [projectId]
  );
  
  let projectDb;
  
  if (projectDbResult.rows.length === 0) {
    // Create new database for project
    const dbName = `turbobackend_proj_${projectId.replace(/-/g, '_')}`;
    
    console.log(`[DevDB] Creating new database: ${dbName}`);
    
    // Create database on dev DB server
    const adminConnection = new Pool({
      host: process.env.DB_CLUSTER_HOST,
      port: process.env.DB_CLUSTER_PORT,
      user: process.env.DB_CLUSTER_USER,
      password: process.env.DB_CLUSTER_PASSWORD,
      database: 'postgres' // Connect to default database to create new one
    });
    
    await adminConnection.query(`CREATE DATABASE ${dbName}`);
    await adminConnection.end();
    
    // Store in database
    const databaseId = nanoid();
    const now = Math.floor(Date.now() / 1000);
    
    await client.query(
      `INSERT INTO ${process.env.PG_DB_SCHEMA}.project_databases 
       (database_id, project_id, user_id, db_name, db_schema, environment, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [databaseId, projectId, 'user_id', dbName, 'public', 'development', true, now, now]
    );
    
    projectDb = { db_name: dbName, db_schema: 'public' };
    
    console.log(`[DevDB] ✅ Database created: ${dbName}`);
  } else {
    projectDb = projectDbResult.rows[0];
  }
  
  // Connect to project's database using cluster credentials from env vars
  const devDbConnection = new Pool({
    host: process.env.DB_CLUSTER_HOST,
    port: process.env.DB_CLUSTER_PORT,
    database: projectDb.db_name,
    user: process.env.DB_CLUSTER_USER,
    password: process.env.DB_CLUSTER_PASSWORD
  });
  
  const devClient = await devDbConnection.connect();
  
  const executionResults = [];
  
  try {
    await devClient.query('BEGIN');
    
    for (const queryObj of queries) {
      // Modify query to use 'public' schema instead of 'turbobackend'
      const modifiedQuery = queryObj.query.replace(/turbobackend\./g, 'public.');
      
      try {
        const result = await devClient.query(modifiedQuery);
        
        executionResults.push({
          query: modifiedQuery,
          schemaName: queryObj.schemaName,
          type: queryObj.type,
          success: true,
          rowsAffected: result.rowCount
        });
        
        // Record in main database
        const queryId = nanoid();
        const now = Math.floor(Date.now() / 1000);
        
        await client.query(
          `INSERT INTO ${process.env.PG_DB_SCHEMA}.generated_queries 
           (query_id, project_id, query_text, query_type, schema_name, execution_status, executed_at, environment, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [queryId, projectId, modifiedQuery, queryObj.type, queryObj.schemaName, 'executed', now, 'development', now]
        );
        
        console.log(`[DevDB] ✅ Executed: ${queryObj.type} for ${queryObj.schemaName}`);
        
      } catch (error) {
        executionResults.push({
          query: modifiedQuery,
          schemaName: queryObj.schemaName,
          type: queryObj.type,
          success: false,
          error: error.message
        });
        
        // Record failure in main database
        const queryId = nanoid();
        const now = Math.floor(Date.now() / 1000);
        
        await client.query(
          `INSERT INTO ${process.env.PG_DB_SCHEMA}.generated_queries 
           (query_id, project_id, query_text, query_type, schema_name, execution_status, error_message, environment, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [queryId, projectId, modifiedQuery, queryObj.type, queryObj.schemaName, 'failed', error.message, 'development', now]
        );
        
        console.error(`[DevDB] ❌ Failed: ${queryObj.type} for ${queryObj.schemaName}`, error);
        throw error;
      }
    }
    
    await devClient.query('COMMIT');
    
    console.log(`[DevDB] ✅ All queries executed successfully`);
    
    // Track query execution activity
    if (userId && executionResults.length > 0) {
      try {
        const tableNames = [...new Set(executionResults.map(function(r) { return r.schemaName; }))].join(', ');
        await trackActivity({
          projectId,
          userId,
          requestId,
          actionType: 'queries_executed',
          actionDetails: `Executed ${executionResults.length} queries affecting tables: ${tableNames}`,
          status: 'success',
          environment: 'development',
          client
        });
      } catch (error) {
        console.error(`[ActivityTracker] Failed to track query execution: ${error.message}`);
      }
    }
    
    return {
      success: true,
      queriesExecuted: executionResults.length,
      results: executionResults,
      dbName: projectDb.db_name
    };
    
  } catch (error) {
    await devClient.query('ROLLBACK');
    throw error;
  } finally {
    devClient.release();
    await devDbConnection.end();
  }
}
