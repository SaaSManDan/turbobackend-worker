# Feature 4: Activity Tracking System - Technical Implementation Plan

## Overview
Create a centralized activity tracking system to log all significant events and changes made to backend projects. This will be displayed on the user's project console to show a timeline of project activities.

## Database Schema

### Existing Table: `project_actions`
Current schema:
```
action_id | varchar | PRIMARY KEY
project_id | varchar
user_id | varchar
request_id | varchar
action_type | varchar
action_details | varchar
status | varchar
cost_usd | decimal(10, 6)
environment | varchar
created_at | bigint
```

### Updated Schema
```
Table: project_actions
action_id | varchar | PRIMARY KEY
project_id | varchar
user_id | varchar
request_id | varchar | (nullable - some events might not have a request)
action_type | varchar | (e.g., "project_created", "endpoints_added", "database_created")
action_details | varchar | (flexible text field for event-specific data)
status | varchar | (e.g., "success", "failed", "in_progress")
environment | varchar | (e.g., "development", "production")
created_at | bigint
```

**Note**: Cost tracking is handled separately by the message cost tracker system.

## Event Types & Data Structures

### 1. Project Created
```
action_type: "project_created"
action_details: "Project 'My API' created with container abc123"
```

### 2. Database Created
```
action_type: "database_created"
action_details: "Database 'turbobackend_proj_xyz' created with 3 tables: users, posts, comments"
```

### 3. API Endpoints Added
```
action_type: "endpoints_added"
action_details: "Added 2 endpoints: GET /api/users, POST /api/users"
```

### 4. Database Queries Executed
```
action_type: "queries_executed"
action_details: "Executed 5 queries affecting tables: users, posts"
```

### 5. Code Deployed
```
action_type: "deployment"
action_details: "Deployed to fly.io: https://turbobackend-xyz.fly.dev"
```

### 6. GitHub Push
```
action_type: "github_push"
action_details: "Pushed 5 files to https://github.com/user/repo"
```

### 7. Endpoints Modified
```
action_type: "endpoints_modified"
action_details: "Modified GET /api/users: Added pagination"
```

### 8. Database Tables Added
```
action_type: "tables_added"
action_details: "Added 2 tables to turbobackend_proj_xyz: orders, payments"
```

## Implementation

### Core Function
**Location**: `worker/utils/activityTracker.js`

```javascript
/**
 * Track project activity/event
 */
export async function trackActivity({
  projectId,
  userId,
  requestId = null,
  actionType,
  actionDetails,
  status = 'success',
  environment = 'development',
  client = null
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
       (action_id, project_id, user_id, request_id, action_type, action_details, status, environment, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [actionId, projectId, userId, requestId, actionType, actionDetails, status, environment, now]
    );
    
    console.log(`[ActivityTracker] Logged: ${actionType} for project ${projectId}`);
    
    return actionId;
  } finally {
    if (shouldCloseClient) {
      client.release();
    }
  }
}
```

## Integration Points

### 1. Project Creation
**Location**: `worker/handlers/projectCreationExecutionHandler.js`

```javascript
// After successful project creation
await trackActivity({
  projectId: project_id,
  userId: user_id,
  requestId,
  actionType: 'project_created',
  actionDetails: `Project '${projectName}' created with container ${containerId}`,
  status: 'success',
  environment: 'development',
  client
});
```

### 2. Database Creation
**Location**: `worker/utils/databaseProvisioner.js` (new file from Feature 1)

```javascript
// After database provisioned
const tableNames = schemaDesign.tables.map(t => t.tableName).join(', ');
await trackActivity({
  projectId,
  userId,
  requestId,
  actionType: 'database_created',
  actionDetails: `Database '${dbName}' created with ${schemaDesign.tables.length} tables: ${tableNames}`,
  status: 'success',
  environment: 'development',
  client
});
```

### 3. Endpoints Added
**Location**: `worker/handlers/projectCreationExecutionHandler.js`

```javascript
// After agentic loop completes
if (agentResult.filesModified?.length > 0) {
  const endpoints = agentResult.filesModified
    .filter(f => f.type === 'route')
    .map(f => ({
      method: extractMethod(f.path),
      path: extractApiPath(f.path)
    }));
  
  if (endpoints.length > 0) {
    const endpointList = endpoints.map(e => `${e.method} ${e.path}`).join(', ');
    await trackActivity({
      projectId: project_id,
      userId: user_id,
      requestId,
      actionType: 'endpoints_added',
      actionDetails: `Added ${endpoints.length} endpoints: ${endpointList}`,
      status: 'success',
      environment: 'development',
      client
    });
  }
}
```

### 4. Database Queries Executed
**Location**: `worker/utils/devDatabaseExecutor.js`

```javascript
// After queries executed
const tableNames = [...new Set(queries.map(q => q.schemaName))].join(', ');
await trackActivity({
  projectId,
  userId,
  requestId,
  actionType: 'queries_executed',
  actionDetails: `Executed ${queries.length} queries affecting tables: ${tableNames}`,
  status: 'success',
  environment: 'development',
  client
});
```

### 5. Deployment
**Location**: `worker/services/flyioService.js`

```javascript
// After successful deployment
await trackActivity({
  projectId,
  userId,
  requestId,
  actionType: 'deployment',
  actionDetails: `Deployed to fly.io: ${deploymentUrl}`,
  status: 'success',
  environment: 'production',
  client
});
```

### 6. GitHub Push
**Location**: `worker/utils/githubIntegration.js`

```javascript
// After successful push
await trackActivity({
  projectId,
  userId,
  requestId,
  actionType: 'github_push',
  actionDetails: `Pushed ${filesModified.length} files to ${repoUrl}`,
  status: 'success',
  environment: 'development',
  client
});
```

## Files to Create/Modify

### New Files:
1. `worker/utils/activityTracker.js` - Core tracking functions

### Modified Files:
1. `worker/handlers/projectCreationExecutionHandler.js` - Track project creation, endpoints added
2. `worker/utils/databaseProvisioner.js` - Track database creation (from Feature 1)
3. `worker/utils/devDatabaseExecutor.js` - Track query execution
4. `worker/services/flyioService.js` - Track deployments
5. `worker/utils/githubIntegration.js` - Track GitHub pushes

### Database Migration:
No migration needed - the table already has the correct schema with varchar for action_details.

## Error Handling
- Activity tracking should NEVER fail the main operation
- Wrap all `trackActivity` calls in try/catch
- Log errors but continue execution
- Consider making tracking async/non-blocking

## Future Enhancements
- Add activity filtering by action_type
- Add activity search functionality
- Add activity aggregation (e.g., "5 endpoints added today")
- Add activity notifications/webhooks
- Add activity export functionality
