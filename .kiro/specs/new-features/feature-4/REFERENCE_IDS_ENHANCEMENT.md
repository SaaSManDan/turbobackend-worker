# Reference IDs Enhancement - Activity Tracking

## Overview
Added `reference_ids` JSONB column to `project_actions` table to link activities with related records across different tables.

## Implementation

### Database Schema Change
```sql
ALTER TABLE turbobackend.project_actions 
ADD COLUMN IF NOT EXISTS reference_ids JSONB;
```

### Updated Function Signature
```javascript
export async function trackActivity({
    projectId,
    userId,
    requestId = null,
    actionType,
    actionDetails,
    status = 'success',
    environment = 'development',
    referenceIds = null,  // NEW: JSONB object with reference IDs
    client = null,
})
```

## Usage Examples

### 1. Track Deployment with References
```javascript
await trackActivity({
  projectId: project_id,
  userId: user_id,
  requestId,
  actionType: 'deployment',
  actionDetails: `Deployed to fly.io: ${appUrl}`,
  status: 'success',
  environment: 'production',
  referenceIds: {
    deployment_id: deploymentId,
    app_name: appName
  },
  client
});
```

### 2. Track GitHub Push with References
```javascript
await trackActivity({
  projectId,
  userId,
  requestId,
  actionType: 'github_push',
  actionDetails: `Pushed ${filesModified.length} files to ${repoUrl}`,
  status: 'success',
  environment: 'development',
  referenceIds: {
    github_push_id: pushId,
    commit_sha: commitSha
  },
  client
});
```

### 3. Track Database Creation with References
```javascript
await trackActivity({
  projectId,
  userId,
  requestId,
  actionType: 'database_created',
  actionDetails: `Database '${dbName}' created with ${schemaDesign.tables.length} tables`,
  status: 'success',
  environment: 'development',
  referenceIds: {
    database_id: databaseId,
    database_name: dbName
  },
  client
});
```

### 4. Track Project Creation with References
```javascript
await trackActivity({
  projectId: project_id,
  userId: user_id,
  requestId,
  actionType: 'project_created',
  actionDetails: `Project created with container ${containerId}`,
  status: 'success',
  environment: 'development',
  referenceIds: {
    container_id: containerId,
    container_session_id: sessionId
  },
  client
});
```

## Querying with Reference IDs

### Find all activities for a specific deployment
```sql
SELECT * FROM turbobackend.project_actions 
WHERE reference_ids->>'deployment_id' = 'deploy_abc123';
```

### Find all activities with GitHub pushes
```sql
SELECT * FROM turbobackend.project_actions 
WHERE reference_ids ? 'github_push_id';
```

### Find all activities for a specific container
```sql
SELECT * FROM turbobackend.project_actions 
WHERE reference_ids->>'container_id' = 'container_xyz789';
```

### Get activity with related records (JOIN example)
```sql
SELECT 
  pa.*,
  gph.commit_sha,
  gph.files_changed
FROM turbobackend.project_actions pa
LEFT JOIN turbobackend.github_push_history gph 
  ON gph.push_id = pa.reference_ids->>'github_push_id'
WHERE pa.project_id = 'project_123'
ORDER BY pa.created_at DESC;
```

## Benefits

1. **Traceability** - Link activities to specific records in other tables
2. **Flexibility** - Store multiple reference types in one column
3. **Queryable** - JSONB supports efficient queries and indexing
4. **Future-proof** - Easy to add new reference types without schema changes
5. **Backward Compatible** - NULL for existing records without references

## Reference ID Types

Common reference ID keys used:
- `github_push_id` - Links to `github_push_history.push_id`
- `deployment_id` - Links to `project_deployments.deployment_id`
- `container_id` - Container identifier
- `container_session_id` - Links to `container_sessions.session_id`
- `database_id` - Links to `project_databases.database_id`
- `commit_sha` - Git commit SHA
- `app_name` - Fly.io app name
- `database_name` - Database name
- `branch_name` - Git branch name (for modifications)

## Files Modified

1. `worker/utils/activityTracker.js` - Added `referenceIds` parameter
2. `worker/handlers/projectCreationExecutionHandler.js` - Added references to project creation tracking
3. `worker/utils/githubIntegration.js` - Added references to GitHub push tracking
4. `worker/services/flyioService.js` - Added references to deployment tracking
5. `worker/utils/databaseProvisioner.js` - Added references to database creation tracking
6. `database-migrations.sql` - Added column migration
7. `technicalContext.txt` - Updated schema documentation

## Testing

✅ All tests passed with reference IDs functionality
✅ Database migration completed successfully
✅ No diagnostics errors found
