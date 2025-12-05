# Feature 2: Project Modification Processor - Technical Implementation Plan

## Overview
Create a new processor that handles modification requests to existing projects. This allows users to modify their backend projects after initial creation by adding endpoints, modifying business logic, adding database tables, and making other changes.

## Key Differences from Initial Creation
- Creates a **new sandbox** for each modification (clean environment)
- Clones project from GitHub repository
- Creates a new feature branch for modifications
- Merges changes back to main branch after completion
- Reuses existing database connections
- Tracks modifications as activities in `project_actions` table

## Architecture

### New Processor
**Location**: `worker/processors/projectModification.js`

This processor will:
1. Validate that the project exists
2. Provision a brand new sandbox/container
3. Clone project from GitHub repository
4. Create a new feature branch
5. Load existing project context (files, database schema)
6. Run agentic loop with modification context
7. Commit and push changes to feature branch
8. Merge feature branch to main
9. Track modifications as activities
10. Optionally redeploy to Fly.io

### New Handler
**Location**: `worker/handlers/projectModificationExecutionHandler.js`

This handler orchestrates the modification flow with these steps:
1. Provision a new sandbox/container
2. Clone project from GitHub repository
3. Create a new feature branch (e.g., `feature/modification-{timestamp}`)
4. Load existing project context (files, database schema)
5. Run agentic loop with modification context
6. Commit changes to feature branch
7. Push feature branch to GitHub
8. Merge feature branch to main
9. Optionally redeploy from main branch

## Reusable Components

### ✅ Can Reuse Directly
1. **`runAgenticLoop()`** - Core AI agent execution
   - Already supports iterative modifications
   - Can work with existing code
   - Handles file writes and database queries

2. **`trackActivity()`** - Activity tracking
   - Track endpoint modifications
   - Track new endpoints added
   - Track database table additions
   - Track business logic changes

3. **GitHub Branch Management** - New utility functions
   - Clone from GitHub
   - Create feature branches
   - Commit and push changes
   - Merge branches

4. **`deployProjectToFlyIO()`** - Deployment
   - Can redeploy existing apps
   - Updates running deployments

5. **`executeCommandInContainer()`** - Container commands
   - Execute any command in new sandbox
   - Read/write files

6. **`provisionAndCreateTables()`** - Database table creation
   - Can add new tables to existing database
   - Handles schema updates

### 🔧 Need Modification/Extension
1. **Container Management**
   - Provision new sandbox for each modification
   - Clone from GitHub repository
   - Create and manage feature branches

2. **Project Context Loading**
   - Read existing files from cloned repository
   - Load current database schema
   - Get list of existing endpoints

3. **GitHub Branch Management**
   - Create feature branches
   - Merge feature branches to main
   - Handle merge conflicts

## Database Schema

### No New Tables Required

We will reuse existing tables:
- **`project_actions`** - Track modification activities (already exists from Feature 4)
  - Uses `reference_ids` JSONB column to link to related records
- **`github_push_history`** - Track file changes with JSONB (already exists)
- **`container_sessions`** - Track new sandbox sessions (already exists)

**Activity Types for Modifications:**
- `endpoints_added` - New endpoints added to existing project
- `endpoints_modified` - Existing endpoints modified
- `tables_added` - New database tables added
- `business_logic_modified` - Non-endpoint code changes
- `dependency_added` - New npm packages installed
- `configuration_changed` - Config file updates

**Example reference_ids for modifications:**
```json
{
  "github_push_id": "push_abc123",
  "container_session_id": "session_xyz789",
  "branch_name": "feature/modification-1234567890"
}
```

## Implementation

### 1. Project Modification Processor
**Location**: `worker/processors/projectModification.js`

```javascript
import { handleProjectModificationOrchestration } from "../handlers/projectModificationExecutionHandler.js";
import pool from "../../databases/postgresConnector.js";
import { nanoid } from "nanoid";

export async function projectModificationProcessor(job) {
  const { mcp_key_id, tool_name, request_params, user_id, project_id, streamId } = job.data;
  
  console.log(`[ProjectModification] Processing job ${job.id}`);
  console.log(`[ProjectModification] Tool: ${tool_name}, Project: ${project_id}`);
  console.log(`[ProjectModification] Modification request: ${request_params.modificationRequest}`);
  
  // Log request to DB
  const requestId = await logMCPRequest(mcp_key_id, tool_name, request_params);
  
  // Handle modification through orchestration handler
  return await handleProjectModificationOrchestration(job, requestId, streamId);
}

async function logMCPRequest(mcpKeyId, toolName, requestParams) {
  const client = await pool.connect();
  
  try {
    const requestId = nanoid();
    const now = Math.floor(Date.now() / 1000);
    
    await client.query(
      `INSERT INTO ${process.env.PG_DB_SCHEMA}.mcp_requests 
       (request_id, mcp_key_id, tool_name, request_params, response_status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [requestId, mcpKeyId, toolName, JSON.stringify(requestParams), 'processing', now]
    );
    
    return requestId;
  } finally {
    client.release();
  }
}
```

### 2. Project Modification Handler
**Location**: `worker/handlers/projectModificationExecutionHandler.js`

```javascript
import pool from "../../databases/postgresConnector.js";
import { provisionDaytonaContainer } from "../services/daytonaService.js";
import { runAgenticLoop } from "../llms/agenticLoopExecutor.js";
import { deployProjectToFlyIO } from "../services/flyioService.js";
import { publishProgress, publishSuccess, publishError } from "../pubsub-handlers.js";
import { loadProjectContext } from "../utils/projectContextLoader.js";
import { trackActivity } from "../utils/activityTracker.js";
import { 
  getProjectGitHubRepo, 
  cloneProjectFromGitHub, 
  createFeatureBranch,
  commitChanges,
  pushFeatureBranch,
  mergeFeatureBranch,
  pushToMain
} from "../utils/githubBranchManager.js";
import { nanoid } from "nanoid";

export async function handleProjectModificationOrchestration(job, requestId, streamId) {
  const { user_id, project_id, request_params } = job.data;
  const { modificationRequest, shouldRedeploy = false } = request_params;
  
  console.log(`[ProjectModification] Starting for project: ${project_id}`);
  console.log(`[ProjectModification] Request: "${modificationRequest}"`);
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    await publishProgress(streamId, "Provisioning new sandbox...", 10);
    
    // Phase 1: Provision new sandbox
    console.log(`[ProjectModification] Phase 1: Provisioning new sandbox`);
    const containerId = await provisionDaytonaContainer(project_id);
    await publishProgress(streamId, "Sandbox provisioned", 15);
    
    // Phase 2: Get GitHub repo URL
    console.log(`[ProjectModification] Phase 2: Getting GitHub repository`);
    const repoInfo = await getProjectGitHubRepo(project_id, client);
    await publishProgress(streamId, "Repository found", 20);
    
    // Phase 3: Clone project from GitHub
    console.log(`[ProjectModification] Phase 3: Cloning project from GitHub`);
    await cloneProjectFromGitHub(containerId, repoInfo);
    await publishProgress(streamId, "Project cloned", 25);
    
    // Phase 4: Create feature branch
    const branchName = `feature/modification-${Date.now()}`;
    console.log(`[ProjectModification] Phase 4: Creating feature branch: ${branchName}`);
    await createFeatureBranch(containerId, branchName);
    await publishProgress(streamId, `Feature branch created: ${branchName}`, 30);
    
    // Phase 5: Load project context
    console.log(`[ProjectModification] Phase 5: Loading project context`);
    const projectContext = await loadProjectContext(containerId, project_id, client);
    await publishProgress(streamId, "Project context loaded", 35);
    
    // Phase 6: Run agentic loop with modification context
    console.log(`[ProjectModification] Phase 6: Starting modification loop`);
    await publishProgress(streamId, "Processing modifications", 40);
    
    const agentResult = await runAgenticLoop({
      containerId,
      projectId: project_id,
      userId: user_id,
      userRequest: modificationRequest,
      requestId,
      databaseSchema: projectContext.databaseSchema,
      existingFiles: projectContext.files,
      existingEndpoints: projectContext.endpoints
    });
    
    await publishProgress(streamId, "Modifications complete", 70);
    
    // Phase 7: Handle new database tables if needed
    if (agentResult.dbQueries?.length > 0) {
      console.log(`[ProjectModification] Adding new database tables`);
      // Extract CREATE TABLE queries
      const createTableQueries = agentResult.dbQueries.filter(function(q) {
        return q.type === 'CREATE TABLE';
      });
      
      if (createTableQueries.length > 0) {
        // Add tables to existing database
        await addTablesToExistingDatabase(
          project_id,
          user_id,
          createTableQueries,
          client,
          requestId
        );
        
        await trackActivity({
          projectId: project_id,
          userId: user_id,
          requestId,
          actionType: 'tables_added',
          actionDetails: `Added ${createTableQueries.length} new tables`,
          status: 'success',
          environment: 'development',
          client
        });
      }
    }
    
    // Phase 8: Commit and push feature branch
    console.log(`[ProjectModification] Phase 8: Committing changes to feature branch`);
    await commitChanges(containerId, `Modification: ${modificationRequest}`);
    await pushFeatureBranch(containerId, branchName);
    await publishProgress(streamId, "Feature branch pushed", 80);
    
    // Phase 9: Merge feature branch to main
    console.log(`[ProjectModification] Phase 9: Merging feature branch to main`);
    await mergeFeatureBranch(containerId, branchName);
    await pushToMain(containerId);
    await publishProgress(streamId, "Changes merged to main", 85);
    
    // Track GitHub push activity
    await trackActivity({
      projectId: project_id,
      userId: user_id,
      requestId,
      actionType: 'github_push',
      actionDetails: `Pushed ${agentResult.filesModified?.length || 0} modified files to ${repoInfo.repo_url}`,
      status: 'success',
      environment: 'development',
      client
    });
    
    // Track modification activity
    if (agentResult.filesModified?.length > 0) {
      const modificationType = determineModificationType(agentResult.filesModified);
      await trackActivity({
        projectId: project_id,
        userId: user_id,
        requestId,
        actionType: modificationType,
        actionDetails: `${modificationRequest} (${agentResult.filesModified.length} files changed)`,
        status: 'success',
        environment: 'development',
        client
      });
    }
    
    // Phase 10: Redeploy if requested
    let deploymentResult = null;
    if (shouldRedeploy) {
      console.log(`[ProjectModification] Phase 10: Redeploying to Fly.io`);
      deploymentResult = await deployProjectToFlyIO(
        project_id,
        repoInfo.repo_url,
        containerId,
        client,
        projectContext.databaseInfo,
        user_id,
        requestId
      );
      await publishProgress(streamId, "Redeployment complete", 95);
    }
    
    // Phase 11: Record container session
    const sessionId = nanoid();
    const now = Math.floor(Date.now() / 1000);
    await client.query(
      `INSERT INTO ${process.env.PG_DB_SCHEMA}.container_sessions
       (session_id, project_id, container_id, container_provider, status, environment, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, project_id, containerId, 'daytona', 'completed', 'development', now]
    );
    
    await client.query('COMMIT');
    
    console.log(`[ProjectModification] ✅ Modification complete`);
    
    const successMessage = `Project modifications completed successfully!\n\nFiles modified: ${agentResult.filesModified?.length || 0}\n${deploymentResult ? `Redeployed to: ${deploymentResult.url}` : ''}\n\nSummary: ${agentResult.summary}`;
    
    await publishSuccess(streamId, successMessage);
    
    return {
      success: true,
      requestId,
      containerId,
      branchName,
      filesModified: agentResult.filesModified,
      deploymentResult
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[ProjectModification] ❌ Error:`, error);
    
    await publishError(streamId, `Modification failed: ${error.message}`);
    
    throw error;
  } finally {
    client.release();
  }
}

function determineModificationType(filesModified) {
  const hasNewRoutes = filesModified.some(function(f) {
    return f.type === 'route' && f.isNew;
  });
  const hasModifiedRoutes = filesModified.some(function(f) {
    return f.type === 'route' && !f.isNew;
  });
  
  if (hasNewRoutes) return 'endpoint_added';
  if (hasModifiedRoutes) return 'endpoint_modified';
  return 'business_logic_modified';
}

async function addTablesToExistingDatabase(projectId, userId, createTableQueries, client, requestId) {
  // Get existing database info
  const dbResult = await client.query(
    `SELECT * FROM ${process.env.PG_DB_SCHEMA}.project_databases 
     WHERE project_id = $1 AND is_active = true`,
    [projectId]
  );
  
  if (dbResult.rows.length === 0) {
    throw new Error('No active database found for project');
  }
  
  const dbInfo = dbResult.rows[0];
  
  // Execute CREATE TABLE queries on existing database
  // Implementation similar to provisionAndCreateTables but for existing DB
  console.log(`[ProjectModification] Adding ${createTableQueries.length} tables to ${dbInfo.db_name}`);
  
  // TODO: Execute queries on existing database
}
```

### 3. Project Context Loader
**Location**: `worker/utils/projectContextLoader.js`

```javascript
import { executeCommandInContainer, readFileFromContainer } from "../services/daytonaService.js";

export async function loadProjectContext(containerId, projectId, client) {
  console.log(`[ContextLoader] Loading context for project ${projectId}`);
  
  // Get database info
  const dbResult = await client.query(
    `SELECT * FROM ${process.env.PG_DB_SCHEMA}.project_databases 
     WHERE project_id = $1 AND is_active = true`,
    [projectId]
  );
  
  const databaseInfo = dbResult.rows.length > 0 ? dbResult.rows[0] : null;
  
  // Get database schema if database exists
  let databaseSchema = null;
  if (databaseInfo) {
    // Query database for table structure
    databaseSchema = await loadDatabaseSchema(databaseInfo);
  }
  
  // List existing files in project
  const filesResult = await executeCommandInContainer(
    containerId,
    'find server/api -name "*.js" -o -name "*.ts" 2>/dev/null || echo "No API files found"'
  );
  
  const files = filesResult.result ? filesResult.result.split('\n').filter(function(f) {
    return f.trim() !== '' && f !== 'No API files found';
  }) : [];
  
  // Extract endpoints from file paths
  const endpoints = files.map(function(filePath) {
    const fileName = filePath.split('/').pop();
    const method = fileName.split('.')[1]?.toUpperCase() || 'UNKNOWN';
    const path = filePath.replace(/^.*\/api\//, '/api/').replace(/\.[^.]+\.js$/, '');
    return { method, path, file: filePath };
  });
  
  console.log(`[ContextLoader] Found ${endpoints.length} existing endpoints`);
  console.log(`[ContextLoader] Database: ${databaseInfo ? databaseInfo.db_name : 'None'}`);
  
  return {
    databaseInfo,
    databaseSchema,
    files,
    endpoints
  };
}

async function loadDatabaseSchema(databaseInfo) {
  // TODO: Query database to get table structure
  // For now, return null
  return null;
}
```

### 4. GitHub Repository Management
**Location**: `worker/utils/githubBranchManager.js` (new file)

```javascript
import { executeCommandInContainer } from "../services/daytonaService.js";

export async function getProjectGitHubRepo(projectId, client) {
  const result = await client.query(
    `SELECT * FROM ${process.env.PG_DB_SCHEMA}.project_github_repos 
     WHERE project_id = $1 AND is_active = true 
     ORDER BY created_at DESC 
     LIMIT 1`,
    [projectId]
  );
  
  if (result.rows.length === 0) {
    throw new Error(`No GitHub repository found for project ${projectId}`);
  }
  
  return result.rows[0];
}

export async function cloneProjectFromGitHub(containerId, repoInfo) {
  const { repo_url, branch } = repoInfo;
  
  console.log(`[GitHub] Cloning ${repo_url} (branch: ${branch})`);
  
  // Clone with authentication
  const authenticatedUrl = repo_url.replace('https://', `https://${process.env.GITHUB_ACCESS_TOKEN}@`);
  
  await executeCommandInContainer(
    containerId,
    `git clone -b ${branch} ${authenticatedUrl} .`
  );
  
  // Configure git
  await executeCommandInContainer(containerId, 'git config user.name "TurboBackend Agent"');
  await executeCommandInContainer(containerId, 'git config user.email "agent@turbobackend.dev"');
  
  console.log(`[GitHub] Project cloned successfully`);
}

export async function createFeatureBranch(containerId, branchName) {
  console.log(`[GitHub] Creating feature branch: ${branchName}`);
  
  await executeCommandInContainer(containerId, `git checkout -b ${branchName}`);
  
  console.log(`[GitHub] Feature branch created`);
}

export async function commitChanges(containerId, commitMessage) {
  console.log(`[GitHub] Committing changes`);
  
  await executeCommandInContainer(containerId, 'git add .');
  await executeCommandInContainer(containerId, `git commit -m "${commitMessage}"`);
  
  console.log(`[GitHub] Changes committed`);
}

export async function pushFeatureBranch(containerId, branchName) {
  console.log(`[GitHub] Pushing feature branch: ${branchName}`);
  
  await executeCommandInContainer(containerId, `git push origin ${branchName}`);
  
  console.log(`[GitHub] Feature branch pushed`);
}

export async function mergeFeatureBranch(containerId, branchName) {
  console.log(`[GitHub] Merging ${branchName} to main`);
  
  await executeCommandInContainer(containerId, 'git checkout main');
  await executeCommandInContainer(containerId, `git merge ${branchName}`);
  
  console.log(`[GitHub] Feature branch merged`);
}

export async function pushToMain(containerId) {
  console.log(`[GitHub] Pushing to main branch`);
  
  await executeCommandInContainer(containerId, 'git push origin main');
  
  console.log(`[GitHub] Main branch updated`);
}
```

### 5. Register New Processor
**Location**: `worker/processors/processorFunctions.js`

```javascript
import { initialProjectCreationProcessor } from "./initialProjectCreation.js";
import { projectModificationProcessor } from "./projectModification.js";

const registry = {
  initialProjectCreationJob: initialProjectCreationProcessor,
  projectModificationJob: projectModificationProcessor,
};
```

## Integration with Agentic Loop

The agentic loop needs to be enhanced to accept existing project context:

**Location**: `worker/llms/agenticLoopExecutor.js` (modify function signature)

```javascript
export async function runAgenticLoop({
  containerId,
  projectId,
  userId,
  userRequest,
  requestId,
  databaseSchema = null,
  existingFiles = [],
  existingEndpoints = [],
  maxIterations = Infinity
}) {
  // Add context about existing project to system prompt
  if (existingEndpoints.length > 0) {
    systemPrompt += `\n\n=== EXISTING ENDPOINTS ===\n\n`;
    systemPrompt += `This project already has the following endpoints:\n`;
    existingEndpoints.forEach(function(ep) {
      systemPrompt += `- ${ep.method} ${ep.path} (${ep.file})\n`;
    });
    systemPrompt += `\nWhen modifying, preserve existing functionality unless explicitly asked to change it.\n`;
  }
  
  // Rest of implementation remains the same...
}
```

## Files to Create

### New Files:
1. `worker/processors/projectModification.js` - New processor for modifications
2. `worker/handlers/projectModificationExecutionHandler.js` - Orchestration handler
3. `worker/utils/projectContextLoader.js` - Load existing project state
4. `worker/utils/githubBranchManager.js` - GitHub branch operations

### Modified Files:
1. `worker/processors/processorFunctions.js` - Register new processor
2. `worker/llms/agenticLoopExecutor.js` - Support existing project context

## Database Migration

No new tables required. We reuse existing tables:
- `project_actions` - Track modification activities
- `github_push_history` - Track file changes
- `container_sessions` - Track sandbox sessions

## Activity Tracking Integration

The following activities will be tracked:
- `endpoints_modified` - When existing endpoints are changed
- `endpoints_added` - When new endpoints are added to existing project
- `tables_added` - When new database tables are added
- `business_logic_modified` - When non-endpoint code is changed
- `github_push` - When changes are pushed (reused)
- `deployment` - When project is redeployed (reused)

## Error Handling

- Validate project exists before modification
- Validate GitHub repository exists
- Handle git merge conflicts gracefully
- Preserve existing functionality during modifications
- Rollback database changes on failure
- Clean up sandbox after completion or failure
- Track failed modifications in project_actions

## Workflow Summary

1. **New Sandbox** - Provision fresh container for each modification
2. **Clone from GitHub** - Pull latest code from repository
3. **Feature Branch** - Create isolated branch for changes
4. **Modify** - AI agent makes changes in isolated environment
5. **Commit & Push** - Push feature branch to GitHub
6. **Merge** - Merge feature branch to main
7. **Deploy** - Optionally redeploy from main branch
8. **Cleanup** - Sandbox can be destroyed after completion

## Benefits of This Approach

- **Clean Environment** - Each modification starts fresh
- **Version Control** - All changes tracked in git history
- **Isolation** - Feature branches prevent conflicts
- **Rollback** - Easy to revert via git
- **Audit Trail** - Full history in GitHub
- **No State Issues** - No stale container state

## Future Enhancements

- Support for deleting endpoints/tables
- Pull request creation instead of direct merge
- Automated testing before merge
- Diff view of changes made
- Batch modifications
- Scheduled modifications
- Conflict resolution strategies
