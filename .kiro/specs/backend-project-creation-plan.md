# Backend Project Creation with Agentic Container Execution

## Overview
Architecture for creating backend projects via MCP requests using an autonomous AI agent that works within a Daytona container.

## Architecture Flow

```
User → MCP → Backend API → Queue → Worker → Agentic Handler
                                                ↓
                            Provision Container → Agentic Loop
                                                ↓
                            Git Push (Deterministic) → S3 Upload → DB Query Execution
```

## Key Principle

**The AI agent has full autonomy within the container.**

It decides:
- What files to search/read
- What files to create/modify
- What commands to run
- When to validate
- When task is complete

Only container provisioning and post-execution actions are deterministic.

---

## 1. MCP Request Processor

**File**: `worker/processors/mcpRequestProcessor.js`

**Pseudocode**:
```
FUNCTION mcpRequestProcessor(job):
    Extract mcp_key_id, tool_name, request_params, user_id, project_id from job
    
    requestId = logMCPRequest(mcp_key_id, tool_name, request_params)
    
    RETURN handleAgenticExecution(job, requestId)
```

---

## 2. Agentic Execution Handler

**File**: `worker/handlers/agenticExecutionHandler.js`

**Pseudocode**:
```
FUNCTION handleAgenticExecution(job, requestId):
    Extract user_id, project_id, description from job
    
    BEGIN DATABASE TRANSACTION
    
    // Phase 1: Container Setup (DETERMINISTIC)
    containerId = getOrProvisionContainer(project_id)
    
    // Phase 2: Agentic Loop (AUTONOMOUS)
    agentResult = runAgenticLoop(
        containerId, 
        project_id, 
        user_id, 
        description, 
        requestId,
        maxIterations: 15
    )
    
    // Phase 3: Post-Execution (DETERMINISTIC)
    IF agentResult.filesModified exists:
        gitPushResult = pushToGitHubDeterministic(containerId, project_id, agentResult.filesModified)
        s3Result = uploadFilesToS3(containerId, project_id, user_id, agentResult.filesModified)
    
    IF agentResult.dbQueries exists:
        dbResult = executeDevDatabaseQueries(project_id, agentResult.dbQueries)
    
    COMMIT TRANSACTION
    
    RETURN success response with all results
```

---

## 3. Agentic Loop Executor

**File**: `worker/llms/agenticLoopExecutor.js`

**Important Implementation Notes**:
- Uses `callLLMNonStream()` from `worker/llms/xai-non-stream.js`
- Maintains conversation history across iterations for context
- Pass full conversation history as JSON string to `callLLMNonStream()` on each iteration
- Tracks cumulative token usage throughout the loop
- Saves cost to database ONCE at the end using `trackMessageCost()` (not per iteration)

**Pseudocode**:
```
FUNCTION runAgenticLoop(containerId, projectId, userId, userRequest, requestId, maxIterations):
    iteration = 0
    conversationHistory = []
    filesModified = []
    dbQueries = []
    
    // Track cumulative usage for cost tracking
    totalInputTokens = 0
    totalOutputTokens = 0
    startTime = getCurrentTimestamp()
    
    // Initialize conversation
    ADD system prompt to conversationHistory
    ADD user request to conversationHistory
    
    WHILE iteration < maxIterations:
        iteration++
        
        // Call AI agent with full conversation history
        // Uses callLLMNonStream(JSON.stringify(conversationHistory), null)
        result = callLLMNonStream(JSON.stringify(conversationHistory), null)
        agentResponse = JSON.parse(result.text)
        
        // Agent returns:
        // {
        //   reasoning: "...",
        //   commands: [{type, command/path/content, purpose}, ...],
        //   taskComplete: true/false,
        //   summary: "..."
        // }
        
        ADD agentResponse to conversationHistory
        
        // Execute agent's commands
        executionResults = executeAgentCommands(containerId, agentResponse.commands)
        
        // Track modifications
        FOR each command in agentResponse.commands:
            IF command.type == 'write':
                ADD to filesModified
            IF command.type == 'db_query':
                ADD to dbQueries
        
        ADD executionResults to conversationHistory
        
        // Accumulate token usage
        totalInputTokens += agentResponse.usage.inputTokens
        totalOutputTokens += agentResponse.usage.outputTokens
        
        // Check if agent says it's done
        IF agentResponse.taskComplete == true:
            BREAK loop
    
    // Calculate total cost and track ONCE at the end
    endTime = getCurrentTimestamp()
    totalCost = calculateCost(totalInputTokens, totalOutputTokens, 'grok-4-fast')
    
    trackMessageCost({
        usageMetadata: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        projectId, jobId: requestId, userId,
        promptContent: userRequest,
        messageType: 'agentic-container-execution',
        model: 'grok-4-fast',
        timeToCompletion: endTime - startTime,
        startedAt: startTime
    })
    
    RETURN success with filesModified, dbQueries, summary, totalCost, iterations
```

---

## 4. Agent Command Executor

**File**: `worker/utils/agentCommandExecutor.js`

**Pseudocode**:
```
FUNCTION executeAgentCommands(containerId, commands):
    results = []
    
    FOR each command in commands:
        TRY:
            SWITCH command.type:
                CASE 'execute':
                    result = executeCommandInContainer(containerId, command.command)
                CASE 'write':
                    result = writeFileInContainer(containerId, command.path, command.content)
                CASE 'read':
                    result = readFileFromContainer(containerId, command.path)
                CASE 'delete':
                    result = deleteFileInContainer(containerId, command.path)
                CASE 'db_query':
                    result = {stored: true, query: command.query}
            
            ADD {command, success: true, result} to results
        
        CATCH error:
            ADD {command, success: false, error} to results
    
    RETURN results
```

---

## 5. Container Provisioning (Deterministic)

**File**: `worker/services/daytonaService.js`

**Pseudocode**:
```
FUNCTION getOrProvisionContainer(projectId):
    // Check if project has GitHub repo
    repoInfo = queryDatabase("SELECT repo_url, branch, access_token_path 
                              FROM project_github_repos 
                              WHERE project_id = ? AND is_active = true", projectId)
    
    hasGitHubRepo = (repoInfo exists)
    
    // Always provision fresh container
    containerId = provisionDaytonaContainer(projectId, image: 'node:20-alpine')
    
    IF hasGitHubRepo:
        // Clone existing project
        accessToken = getParameterStoreValue(repoInfo.access_token_path)
        repoUrlWithAuth = repoInfo.repo_url with embedded accessToken
        
        executeInContainer(containerId, "git clone -b {branch} {repoUrlWithAuth} .")
        executeInContainer(containerId, "git config user.name 'TurboBackend Agent'")
        executeInContainer(containerId, "git config user.email 'agent@turbobackend.dev'")
        executeInContainer(containerId, "npm install")
    ELSE:
        // Initialize new Nitro.js project
        executeInContainer(containerId, "npm init -y")
        executeInContainer(containerId, "npm install nitro")
        executeInContainer(containerId, "npm install -D typescript @types/node")
        executeInContainer(containerId, "mkdir -p server/api server/middleware server/models server/utils")
        
        writeFile(containerId, "nitro.config.ts", nitroConfigContent)
        writeFile(containerId, "tsconfig.json", tsConfigContent)
        writeFile(containerId, ".gitignore", gitignoreContent)
        
        executeInContainer(containerId, "git init")
        executeInContainer(containerId, "git config user.name 'TurboBackend Agent'")
        executeInContainer(containerId, "git config user.email 'agent@turbobackend.dev'")
        executeInContainer(containerId, "git add .")
        executeInContainer(containerId, "git commit -m 'Initial Nitro.js project setup'")
    
    // Record container session
    saveToDatabase("container_sessions", {
        session_id, project_id, container_id, status: 'active', started_at
    })
    
    RETURN containerId
```

---

## 6. Post-Execution: Git Push (Deterministic)

**File**: `worker/utils/githubIntegration.js`

**Pseudocode**:
```
FUNCTION pushToGitHubDeterministic(containerId, projectId, filesModified):
    // Check if files were actually modified
    gitStatus = executeInContainer(containerId, "git status --porcelain")
    
    IF gitStatus is empty:
        RETURN {success: true, message: "No changes to push"}
    
    // Stage, commit, and push
    executeInContainer(containerId, "git add .")
    
    commitMessage = "Update backend files - {timestamp}"
    executeInContainer(containerId, "git commit -m '{commitMessage}'")
    
    // Check if remote exists
    remoteResult = executeInContainer(containerId, "git remote -v")
    
    IF remote does not exist:
        // First time push - need to create GitHub repo
        repoUrl = createGitHubRepo(projectId)
        executeInContainer(containerId, "git remote add origin {repoUrl}")
        executeInContainer(containerId, "git branch -M main")
        
        // Save repo info to database
        saveToDatabase("project_github_repos", {
            repo_id, project_id, user_id, repo_url, branch: 'main', is_active: true
        })
    
    // Push to GitHub
    executeInContainer(containerId, "git push origin main")
    
    // Get commit info for recording
    commitSha = executeInContainer(containerId, "git rev-parse HEAD").trim()
    repoUrl = executeInContainer(containerId, "git config --get remote.origin.url").trim()
    
    // Record in database
    saveToDatabase("github_push_history", {
        push_id, project_id, commit_sha, commit_message, files_changed, repo_url, pushed_at
    })
    
    RETURN {success: true, commitSha, filesCount, repoUrl}
```

---

## 7. Post-Execution: S3 Upload

**File**: `worker/utils/s3FileUpload.js`

**Pseudocode**:
```
FUNCTION uploadFilesToS3(containerId, projectId, userId, filesModified):
    bucket = S3_PROJECTS_BUCKET
    prefix = "projects/{userId}/{projectId}/"
    
    // Get all project files (excluding node_modules, .git)
    filesResult = executeInContainer(containerId, 
        "find . -type f -not -path './node_modules/*' -not -path './.git/*'")
    
    files = parse filesResult into array
    
    uploadedKeys = []
    
    FOR each filePath in files:
        fileContent = downloadFileFromContainer(containerId, filePath)
        s3Key = prefix + filePath
        
        uploadToS3(bucket, s3Key, fileContent)
        
        ADD s3Key to uploadedKeys
    
    RETURN {success: true, filesUploaded: count, s3Keys: uploadedKeys}

NOTE: File metadata is NOT stored in database. 
To display files in platform, query S3 with prefix "projects/{userId}/{projectId}/"
```

---

## 8. Post-Execution: Database Query Execution

**File**: `worker/utils/devDatabaseExecutor.js`

**Pseudocode**:
```
FUNCTION executeDevDatabaseQueries(projectId, queries):
    // Check if project has a database
    projectDb = queryDatabase("SELECT * FROM project_databases 
                               WHERE project_id = ? AND is_active = true", projectId)
    
    IF projectDb does NOT exist:
        // Create new database for project
        dbName = "proj_{projectId}"
        
        // Create database on dev DB server
        adminConnection = getAdminDatabaseConnection()
        adminConnection.execute("CREATE DATABASE {dbName}")
        
        // Store in database (minimal - host/port/credentials from env vars)
        // Note: environment defaults to 'development' in code
        saveToDatabase("project_databases", {
            database_id, project_id, user_id,
            db_name: dbName,
            db_schema: 'public',
            environment: 'development',  // Set in code, not schema
            is_active: true,
            created_at, updated_at
        })
        
        projectDb = {db_name: dbName, db_schema: 'public', ...}
    
    // Connect to project's database using cluster credentials from env vars
    devDbConnection = connectToDatabase(
        host: process.env.DB_CLUSTER_HOST,
        port: process.env.DB_CLUSTER_PORT,
        database: projectDb.db_name,
        user: process.env.DB_CLUSTER_USER,
        password: process.env.DB_CLUSTER_PASSWORD
    )
    
    BEGIN TRANSACTION on devDbConnection
    
    executionResults = []
    
    FOR each queryObj in queries:
        // Modify query to use 'public' schema instead of 'turbobackend'
        modifiedQuery = queryObj.query.replace('turbobackend.', 'public.')
        
        TRY:
            result = devDbConnection.execute(modifiedQuery)
            
            ADD {query: modifiedQuery, schemaName, type, success: true, rowsAffected} to executionResults
            
            // Record in main database
            saveToDatabase("generated_queries", {
                query_id, project_id, query_text: modifiedQuery, query_type, schema_name,
                execution_status: 'executed', executed_at
            })
        
        CATCH error:
            ADD {query: modifiedQuery, schemaName, type, success: false, error} to executionResults
            
            saveToDatabase("generated_queries", {
                query_id, project_id, query_text: modifiedQuery, query_type, schema_name,
                execution_status: 'failed', error_message
            })
            
            ROLLBACK TRANSACTION
            THROW error
    
    COMMIT TRANSACTION
    
    RETURN {success: true, queriesExecuted: count, results: executionResults, dbName: projectDb.db_name}
```

---

## 9. Container Agent System Prompt

**File**: `worker/llms/prompts/containerAgentSystem.js`

```
You are an expert backend developer with full autonomy to implement user requests 
in a Nitro.js project inside a Daytona container. Imagine you are only working in command line and, as such, you will only get outputs from that are from a command line.

## Your Environment
- Daytona container with Node.js, npm, Unix tools
- Nitro.js project (either new or cloned from GitHub)
- Javascript configured
- Git initialized
- Full filesystem and command access

## Your Autonomy
YOU decide:
- What files to search/read first
- What files to create/modify
- What order to work in
- Whether middleware/utilities/models are needed
- When to validate your work
- When the task is complete

## Your Capabilities

### Explore
- Use ANY Unix command: ls, cat, find, tree, grep, etc.
- Read existing files to understand structure
- Check git status

### Create & Modify
- Write complete TypeScript files
- Create API routes (Nitro.js conventions)
- Generate middleware, models, utilities
- Install npm packages

### Validate
- Run TypeScript checks: npx tsc --noEmit
- Build project: npm run build
- Fix errors you find

### Database
- Generate PostgreSQL CREATE TABLE queries
- Use VARCHAR for IDs, BIGINT for timestamps
- Include constraints (PRIMARY KEY, UNIQUE, NOT NULL)
- IMPORTANT: Use 'public' schema (default PostgreSQL schema) for all tables
- Example: CREATE TABLE public.users (...) NOT CREATE TABLE turbobackend.users (...)

### Git (DO NOT USE - HANDLED AUTOMATICALLY)
- DO NOT run git add, git commit, or git push
- These are handled automatically after you complete the task
- Just focus on creating/modifying code

## Output Format

Respond with JSON:

{
  "reasoning": "What you're doing and why",
  "commands": [
    {
      "type": "execute",
      "command": "tree -L 2",
      "purpose": "See project structure"
    },
    {
      "type": "write",
      "path": "server/api/users/index.get.ts",
      "content": "export default defineEventHandler(async (event) => { ... })",
      "purpose": "Create GET /api/users endpoint"
    },
    {
      "type": "db_query",
      "query": "CREATE TABLE turbobackend.users (...)",
      "schemaName": "users",
      "queryType": "CREATE_TABLE",
      "purpose": "Create users table"
    }
  ],
  "taskComplete": false,
  "summary": "Created user endpoint, still need to add validation"
}

## Command Types

Use ANY command you need:
1. execute - Run any shell command (ls, cat, grep, find, tree, npm, etc.)
2. write - Write/overwrite file (full content)
3. read - Read file
4. delete - Delete file/directory
5. db_query - PostgreSQL query (executed in dev database)

## Task Completion

Set taskComplete: true when:
- All functionality implemented
- No TypeScript errors
- Implementation validated
- All necessary files created

Set taskComplete: false when:
- Still working
- Need to fix errors
- Need to add features

## Best Practices
- Explore before creating
- Follow Nitro.js conventions
- Use TypeScript with types
- Include error handling (try/catch)
- Validate inputs (Zod schemas)
- Add JSDoc comments
- Use ES6 imports/exports
- Use regular functions (not arrow functions)

## Project Structure
/server
  /api              # API routes (auto-routed)
  /middleware       # Middleware
  /models           # Database models
  /utils            # Utilities
nitro.config.ts
package.json
tsconfig.json

You are autonomous, intelligent, and thorough. Work systematically and validate your work.
```

---

## 10. Database Schema

### Generated Queries Table
```sql
-- Purpose: Track all SQL queries generated by AI and their execution status
-- Used for: Audit trail, debugging, rollback, analytics, error tracking
CREATE TABLE turbobackend.generated_queries (
  query_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  request_id VARCHAR,
  query_text TEXT,
  query_type VARCHAR,
  schema_name VARCHAR,
  execution_status VARCHAR,
  executed_at BIGINT,
  error_message TEXT,
  environment VARCHAR,
  created_at BIGINT
);
```

### GitHub Push History Table
```sql
CREATE TABLE turbobackend.github_push_history (
  push_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  request_id VARCHAR,
  commit_sha VARCHAR,
  commit_message TEXT,
  files_changed JSONB,
  repo_url VARCHAR,
  environment VARCHAR,
  pushed_at BIGINT
);
```

### Project GitHub Repositories Table
```sql
CREATE TABLE turbobackend.project_github_repos (
  repo_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  user_id VARCHAR,
  repo_url VARCHAR,
  repo_name VARCHAR,
  branch VARCHAR DEFAULT 'main',
  access_token_path VARCHAR,
  is_active BOOLEAN DEFAULT true,
  environment VARCHAR,
  created_at BIGINT,
  updated_at BIGINT
);
```

### Project Databases Table
```sql
-- Minimal storage: Only track database names
-- Host, port, and credentials come from environment variables:
-- DB_CLUSTER_HOST, DB_CLUSTER_PORT, DB_CLUSTER_USER, DB_CLUSTER_PASSWORD
CREATE TABLE turbobackend.project_databases (
  database_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  user_id VARCHAR,
  db_name VARCHAR,
  db_schema VARCHAR DEFAULT 'public',
  environment VARCHAR,
  is_active BOOLEAN DEFAULT true,
  created_at BIGINT,
  updated_at BIGINT
);
```

### Container Sessions Table
```sql
-- Purpose: Track active Daytona containers for each project
-- Used for: Reusing containers, cleanup, debugging, command execution
CREATE TABLE turbobackend.container_sessions (
  session_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  container_id VARCHAR,
  container_provider VARCHAR DEFAULT 'daytona',
  status VARCHAR,
  container_config JSONB,
  environment VARCHAR,
  started_at BIGINT,
  stopped_at BIGINT
);
```

### Project Actions Table (Recommended - For General Action Tracking)
```sql
-- Purpose: Track all actions performed on projects for analytics and billing
-- Used for: Usage tracking, billing, analytics, audit trail
CREATE TABLE turbobackend.project_actions (
  action_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  user_id VARCHAR,
  request_id VARCHAR,
  action_type VARCHAR,
  -- Action types: 'backend_creation', 'code_modification', 'database_creation',
  --               'database_query', 'github_push', 's3_upload', 'deployment',
  --               'container_provision', 'ai_agent_execution'
  action_details VARCHAR,
  status VARCHAR,
  cost_usd DECIMAL(10, 6),
  environment VARCHAR,
  created_at BIGINT
);
```

### Message Cost Tracker Table
```sql
-- Purpose: Track AI/LLM API costs per message/request
-- Used for: Cost tracking, billing, usage analytics per LLM call
CREATE TABLE turbobackend.message_cost_tracker (
  cost_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  job_id VARCHAR,
  user_id VARCHAR,
  prompt_content TEXT,
  message_type VARCHAR,
  model VARCHAR,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd DECIMAL(10, 6),
  time_to_completion INTEGER,
  started_at BIGINT,
  created_at BIGINT
);
```

**Note**: Set `environment = 'development'` in code when inserting records, not in schema DEFAULT.

---

## 11. Module Structure

```
worker/
├── processors/
│   ├── handlerFunctions.js          # Registry
│   ├── initialProjectCreation.js    # Existing
│   └── mcpRequestProcessor.js       # NEW: MCP entry point
│
├── handlers/
│   └── agenticExecutionHandler.js   # NEW: Main orchestrator
│
├── services/
│   ├── daytonaService.js            # NEW: Container management
│   ├── bedrockService.js            # Existing
│   ├── pineconeService.js           # Existing
│   └── s3Service.js                 # Existing + NEW functions
│
├── llms/
│   ├── agenticLoopExecutor.js       # NEW: Agent loop
│   └── prompts/
│       └── containerAgentSystem.js  # NEW: Agent prompt
│
└── utils/
    ├── agentCommandExecutor.js      # NEW: Execute commands
    ├── githubIntegration.js         # NEW: Git push
    ├── s3FileUpload.js              # NEW: S3 upload
    └── devDatabaseExecutor.js       # NEW: DB queries
```

---

## 12. Complete Flow Example

**User Request**: "Create an API to manage users and a database to store them"

### Phase 1: Container Provisioning (Deterministic)
1. Check if project has GitHub repo in database
2. If no → Provision container, initialize Nitro.js, init git
3. If yes → Provision container, clone from GitHub

### Phase 2: Agentic Loop (Autonomous)

**Iteration 1:**
- Agent: "Let me explore the structure"
- Commands: `[{type: "execute", command: "tree -L 2"}]`
- Result: Shows project structure
- taskComplete: false

**Iteration 2:**
- Agent: "I'll create user CRUD endpoints and database schema"
- Commands:
  - Write `server/api/users/index.get.ts`
  - Write `server/api/users/index.post.ts`
  - Write `server/api/users/[id].get.ts`
  - db_query: `CREATE TABLE turbobackend.users (...)`
- taskComplete: false

**Iteration 3:**
- Agent: "Let me validate TypeScript"
- Commands: `[{type: "execute", command: "npx tsc --noEmit"}]`
- Result: 2 errors found
- taskComplete: false

**Iteration 4:**
- Agent: "Fixing TypeScript errors"
- Commands: Rewrite files with fixes, run tsc again
- Result: No errors
- taskComplete: false

**Iteration 5:**
- Agent: "All done, implementation complete"
- Commands: `[]`
- taskComplete: **true** ← Loop exits

### Phase 3: Post-Execution (Deterministic)

1. **Git Push**:
   - Check `git status` - files changed
   - Run `git add .`
   - Run `git commit -m "Add user management API"`
   - Check if remote exists - no
   - Create GitHub repo via API
   - Run `git remote add origin {url}`
   - Run `git push origin main`
   - Record push in database

2. **S3 Upload**:
   - Get all files from container
   - Upload each to S3
   - Save metadata (NOT content) to database

3. **DB Execution**:
   - Execute CREATE TABLE query in dev database
   - Record execution status in database

### Response
```json
{
  "success": true,
  "iterations": 5,
  "filesModified": 3,
  "dbQueries": 1,
  "agentSummary": "Created user management API with CRUD endpoints",
  "githubPushResult": {"commitSha": "abc123", "repoUrl": "..."},
  "s3UploadResult": {"filesUploaded": 15, "s3Keys": [...]},
  "dbExecutionResult": {"queriesExecuted": 1}
}
```

---

## 13. Key Features

1. ✅ **Full Agent Autonomy** - AI decides everything in container
2. ✅ **Self-Terminating Loop** - Agent sets `taskComplete: true` when done
3. ✅ **Deterministic Git Push** - Automatic after agent completes
4. ✅ **GitHub Integration** - Auto-creates repo on first push
5. ✅ **S3 Storage** - All files backed up
6. ✅ **Metadata-Only DB** - No file content stored, just references
7. ✅ **Dev DB Execution** - SQL queries run automatically
8. ✅ **Clean Architecture** - Clear separation of concerns
9. ✅ **Transaction Safety** - All DB operations in transactions
10. ✅ **Comprehensive Tracking** - Everything logged

---

## 14. Implementation Steps

### Phase 1: Core Infrastructure
1. Create `mcpRequestProcessor.js`
2. Create `agenticExecutionHandler.js`
3. Create database migration scripts
4. Implement `daytonaService.js`

### Phase 2: Agentic Loop
5. Create `CONTAINER_AGENT_SYSTEM_PROMPT`
6. Implement `agenticLoopExecutor.js` with `taskComplete` checking
7. Implement `agentCommandExecutor.js`
8. Add LLM integration

### Phase 3: Post-Execution
9. Implement `githubIntegration.js` (deterministic git push)
10. Implement `s3FileUpload.js`
11. Implement `devDatabaseExecutor.js`
12. Add database tracking functions

### Phase 4: Testing
13. Test container provisioning (new vs existing)
14. Test agentic loop with simple requests
15. Test `taskComplete` termination
16. Test deterministic git push
17. Test S3 upload and DB execution
18. Test end-to-end with complex requests

---

## 15. Summary

This architecture provides true agent autonomy:

- **One autonomous agent** with full container control
- **Agent decides** what to do and when it's done
- **Self-terminating** via `taskComplete` flag
- **Deterministic git push** after agent completes (not agent-controlled)
- **Lightweight database** - metadata only, no file content
- **Simple and flexible** - adapts to any request

The agent is intelligent and autonomous, not following rigid scripts.
