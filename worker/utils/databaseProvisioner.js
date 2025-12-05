import { nanoid } from "nanoid";
import pg from "pg";
import { trackActivity } from "./activityTracker.js";
const { Pool } = pg;

/**
 * Provision database and create tables based on schema design
 */
export async function provisionAndCreateTables(projectId, userId, schemaDesign, client, requestId = null) {
  console.log(`[DatabaseProvisioner] Provisioning database for project ${projectId}`);
  
  const dbName = `turbobackend_proj_${projectId.replace(/-/g, '_')}`.toLowerCase();
  
  try {
    // Create database on cluster
    console.log(`[DatabaseProvisioner] Creating database: ${dbName}`);
    
    const adminConnection = new Pool({
      host: process.env.DB_CLUSTER_HOST,
      port: process.env.DB_CLUSTER_PORT,
      user: process.env.DB_CLUSTER_USER,
      password: process.env.DB_CLUSTER_PASSWORD,
      database: 'postgres'
    });
    
    await adminConnection.query(`CREATE DATABASE ${dbName}`);
    await adminConnection.end();
    
    console.log(`[DatabaseProvisioner] ✅ Database created: ${dbName}`);
    
    // Record in project_databases table
    const databaseId = nanoid();
    const now = Math.floor(Date.now() / 1000);
    
    await client.query(
      `INSERT INTO ${process.env.PG_DB_SCHEMA}.project_databases 
       (database_id, project_id, user_id, db_name, db_schema, environment, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [databaseId, projectId, userId, dbName, 'public', 'development', true, now, now]
    );
    
    // Connect to new database and create tables
    const projectDbConnection = new Pool({
      host: process.env.DB_CLUSTER_HOST,
      port: process.env.DB_CLUSTER_PORT,
      database: dbName,
      user: process.env.DB_CLUSTER_USER,
      password: process.env.DB_CLUSTER_PASSWORD
    });
    
    const projectDbClient = await projectDbConnection.connect();
    
    try {
      await projectDbClient.query('BEGIN');
      
      // Execute CREATE TABLE queries
      for (const table of schemaDesign.tables) {
        console.log(`[DatabaseProvisioner] Creating table: ${table.tableName}`);
        
        await projectDbClient.query(table.createQuery);
        
        // Record query in generated_queries table
        const queryId = nanoid();
        await client.query(
          `INSERT INTO ${process.env.PG_DB_SCHEMA}.generated_queries 
           (query_id, project_id, query_text, query_type, schema_name, execution_status, executed_at, environment, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [queryId, projectId, table.createQuery, 'CREATE TABLE', table.tableName, 'executed', now, 'development', now]
        );
      }
      
      await projectDbClient.query('COMMIT');
      
      console.log(`[DatabaseProvisioner] ✅ Created ${schemaDesign.tables.length} tables`);
      
    } catch (error) {
      await projectDbClient.query('ROLLBACK');
      throw error;
    } finally {
      projectDbClient.release();
      await projectDbConnection.end();
    }
    
    // Track database creation activity
    try {
      const tableNames = schemaDesign.tables.map(function(t) { return t.tableName; }).join(', ');
      await trackActivity({
        projectId,
        userId,
        requestId,
        actionType: 'database_created',
        actionDetails: `Database '${dbName}' created with ${schemaDesign.tables.length} tables: ${tableNames}`,
        status: 'success',
        environment: 'development',
        referenceIds: {
          database_id: databaseId,
          database_name: dbName
        },
        client
      });
    } catch (error) {
      console.error(`[ActivityTracker] Failed to track database creation: ${error.message}`);
    }
    
    // Return database connection info
    return {
      databaseId,
      dbName,
      host: process.env.DB_CLUSTER_HOST,
      port: process.env.DB_CLUSTER_PORT,
      user: process.env.DB_CLUSTER_USER,
      password: process.env.DB_CLUSTER_PASSWORD,
      schema: schemaDesign
    };
    
  } catch (error) {
    console.error(`[DatabaseProvisioner] ❌ Error provisioning database:`, error);
    throw new Error(`Database provisioning failed: ${error.message}`);
  }
}
