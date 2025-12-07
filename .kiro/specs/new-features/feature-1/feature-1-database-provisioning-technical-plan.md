# Feature 1: Dynamic Database Provisioning - Technical Implementation Plan

## Overview
Add intelligent database provisioning capability to the MCP request processor that determines if a Postgres database is needed, designs the schema via AI, and provisions it in the cluster.

## Architecture Flow

### Phase 0.5: Database Detection & Provisioning (BEFORE Container)
**Location**: `worker/handlers/projectCreationExecutionHandler.js`

**Step 1: Database Need Detection**
- Function: `async function detectDatabaseNeed(userPrompt)` (in `worker/utils/databaseNeedDetector.js`)
- Takes user's prompt as input
- Calls AI (using existing `callLLMNonStream` from `worker/llms/xai-non-stream.js`)
- AI analyzes prompt and returns JSON:
  ```json
  {
    "needsDatabase": true/false,
    "reasoning": "explanation of why database is/isn't needed"
  }
  ```

**Step 2: Database Schema Design**
- Function: `async function designDatabaseSchema(userPrompt)` (in `worker/utils/databaseSchemaDesigner.js`)
- Only called if Step 1 returns `true`
- Takes user's prompt as input
- Calls AI with specialized prompt for database design
- AI returns JSON with detailed table definitions and CREATE queries:
  ```json
  {
    "tables": [
      {
        "tableName": "users",
        "columns": [
          {"name": "user_id", "type": "varchar", "constraints": "PRIMARY KEY"},
          {"name": "email", "type": "varchar", "constraints": "UNIQUE NOT NULL"}
        ],
        "createQuery": "CREATE TABLE users (user_id varchar PRIMARY KEY, email varchar UNIQUE NOT NULL)"
      }
    ]
  }
  ```

**Step 3: Database Provisioning & Table Creation**
- Function: `async function provisionAndCreateTables(projectId, schemaDesign, client)` (in `worker/utils/databaseProvisioner.js`)
- Creates new database in cluster using `DB_CLUSTER_*` env variables
- Executes CREATE TABLE queries in transaction
- Records in `project_databases` table
- Records queries in `generated_queries` table
- Returns database connection details:
  ```json
  {
    "dbName": "turbobackend_proj_xyz",
    "host": "cluster-host",
    "port": 5432,
    "user": "cluster-user",
    "password": "cluster-password",
    "schema": {...} // full schema design from Step 2
  }
  ```

### Phase 1: Container Setup (WITH Database Config)
**Location**: `worker/handlers/projectCreationExecutionHandler.js` + `worker/services/daytonaService.js`

**Modifications needed:**
1. Pass database info to `getOrProvisionContainer(projectId, client, databaseInfo)`
2. In `daytonaService.js`, after creating `.env` file, add database env vars if database exists:
   ```javascript
   if (databaseInfo) {
     await sandbox.process.executeCommand(
       `echo "\nDB_HOST=${databaseInfo.host}\nDB_PORT=${databaseInfo.port}\nDB_NAME=${databaseInfo.dbName}\nDB_USER=${databaseInfo.user}\nDB_PASSWORD=${databaseInfo.password}" >> .env`,
       projectDirPath
     );
   }
   ```

### Phase 2: Agentic Loop (WITH Database Schema Context)
**Location**: `worker/handlers/projectCreationExecutionHandler.js` + `worker/llms/agenticLoopExecutor.js`

**Modifications needed:**
1. Pass database schema to `runAgenticLoop`:
   ```javascript
   const agentResult = await runAgenticLoop({
     containerId,
     projectId: project_id,
     userId: user_id,
     userRequest: userPrompt,
     requestId,
     databaseSchema: databaseInfo?.schema || null
   });
   ```

2. Modify system prompt in `worker/llms/prompts/containerAgentSystem.js` to include database schema when available:
   ```
   {if databaseSchema exists}
   
   DATABASE AVAILABLE:
   You have access to a Postgres database with the following schema:
   {JSON.stringify(databaseSchema.tables)}
   
   Database connection is already configured in .env:
   - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
   
   INSTRUCTIONS:
   - Add database connection setup code (e.g., pg.Pool configuration)
   - Write SQL queries in your endpoints using the exact table/column names above
   - Use parameterized queries to prevent SQL injection
   - Handle database errors appropriately
   ```

### Phase 3: Post-Execution (WITH Database Env Vars for Fly.io)
**Location**: `worker/handlers/projectCreationExecutionHandler.js` + `worker/services/flyioService.js`

**Modifications needed:**
1. Pass database info to deployment:
   ```javascript
   deploymentResult = await deployProjectToFlyIO(
     project_id,
     githubRepoUrl,
     containerId,
     client,
     databaseInfo // NEW
   );
   ```

2. In `flyioService.js`, add database secrets to Fly.io after app creation:
   ```javascript
   if (databaseInfo) {
     await executeCommandInContainer(
       containerId,
       `flyctl secrets set DB_HOST=${databaseInfo.host} DB_PORT=${databaseInfo.port} DB_NAME=${databaseInfo.dbName} DB_USER=${databaseInfo.user} DB_PASSWORD=${databaseInfo.password} --app ${appName}`
     );
   }
   ```

3. **REMOVE** the existing `executeDevDatabaseQueries` call from Phase 3 (tables already created in Phase 0.5)

## Integration Points

### 1. Modify `projectCreationExecutionHandler.js`
Add database detection and provisioning BEFORE container setup:
```javascript
export async function handleProjectCreationOrchestration(job, requestId, streamId) {
  const { user_id, project_id, request_params } = job.data;
  const { userPrompt } = request_params;
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    await publishProgress(streamId, "Starting execution...", 10);
    
    // NEW: Phase 0.5 - Database Detection & Provisioning
    let databaseInfo = null;
    const needsDb = await detectDatabaseNeed(userPrompt);
    
    if (needsDb) {
      await publishProgress(streamId, "Detecting database requirements...", 12);
      const schemaDesign = await designDatabaseSchema(userPrompt);
      await publishProgress(streamId, "Provisioning database...", 15);
      databaseInfo = await provisionAndCreateTables(project_id, schemaDesign, client);
      await publishProgress(streamId, "Database provisioned", 18);
    }
    
    // Phase 1: Container Setup (pass databaseInfo)
    const containerId = await getOrProvisionContainer(project_id, client, databaseInfo);
    await publishProgress(streamId, "Container provisioned", 20);
    
    // Phase 2: Agentic Loop (pass databaseSchema)
    const agentResult = await runAgenticLoop({
      containerId,
      projectId: project_id,
      userId: user_id,
      userRequest: userPrompt,
      requestId,
      databaseSchema: databaseInfo?.schema || null
    });
    
    // Phase 3: Post-Execution (pass databaseInfo to deployment, REMOVE executeDevDatabaseQueries)
    if (agentResult.filesModified?.length > 0) {
      // ... github, s3 ...
      deploymentResult = await deployProjectToFlyIO(
        project_id,
        githubRepoUrl,
        containerId,
        client,
        databaseInfo
      );
    }
    
    // REMOVE THIS BLOCK:
    // if (agentResult.dbQueries?.length > 0) {
    //   dbExecutionResult = await executeDevDatabaseQueries(...);
    // }
    
    await client.query('COMMIT');
    // ... rest of handler ...
  }
}
```

## Database Schema Updates

No new tables needed. Use existing:
- `project_databases` - stores database info
- `generated_queries` - stores CREATE TABLE queries

## AI Prompts Needed

### 1. Database Need Detection Prompt
```
Analyze this user request and determine if it requires a relational database.
User Request: "{userPrompt}"

Return JSON only:
{
  "needsDatabase": boolean,
  "reasoning": "brief explanation"
}
```

### 2. Schema Design Prompt
```
Design a Postgres database schema for this application.
User Request: "{userPrompt}"

Return JSON with CREATE TABLE queries using:
- varchar for IDs (nano ids)
- bigint for timestamps (unix seconds)
- Appropriate data types for other fields

Return JSON only:
{
  "tables": [
    {
      "tableName": "table_name",
      "createQuery": "CREATE TABLE table_name (...)"
    }
  ]
}
```

## Files to Create/Modify

### New Files:
1. `worker/utils/databaseNeedDetector.js` - Database need detection logic
2. `worker/utils/databaseSchemaDesigner.js` - Schema design with AI
3. `worker/utils/databaseProvisioner.js` - Database provisioning and table creation

### Modified Files:
1. `worker/handlers/projectCreationExecutionHandler.js` - Add Phase 0.5 (database detection/provisioning), pass databaseInfo to container and deployment, remove executeDevDatabaseQueries call
2. `worker/services/daytonaService.js` - Accept databaseInfo parameter, add database env vars to container .env file
3. `worker/llms/agenticLoopExecutor.js` - Accept databaseSchema parameter, pass to system prompt
4. `worker/llms/prompts/containerAgentSystem.js` - Add database schema section to prompt when database exists
5. `worker/services/flyioService.js` - Accept databaseInfo parameter, add database secrets to Fly.io deployment

## Environment Variables
All existing - no new env vars needed:
- `DB_CLUSTER_HOST`
- `DB_CLUSTER_PORT`
- `DB_CLUSTER_USER`
- `DB_CLUSTER_PASSWORD`

## Cost Tracking
- Track AI calls for database detection and schema design using existing `trackMessageCost` utility
- Add to overall request cost

## Error Handling
- If database detection fails, log warning and continue without database
- If schema design fails, return error to user
- If provisioning fails, rollback and return error
- All wrapped in try/catch with proper logging
