# Feature 5: API Blueprint File Storage - Technical Implementation Plan

## Overview
Change API blueprint storage from database to file-based storage. Store blueprints as `api-blueprint.json` in the project root directory, tracked in git alongside the code. This provides version control, better developer experience, and single source of truth for API documentation.

## Key Changes

### 1. File Format: JSON instead of Markdown
- Store blueprint as `api-blueprint.json` in project root
- Structured data format for easier parsing and tooling
- Can be consumed by frontend, Postman, Swagger, etc.

### 2. Hybrid Approach for Blueprint Creation/Modification

#### Initial Project Creation (AI Response → Worker Creates File)
- AI returns blueprint in response (`apiBlueprint` field)
- Worker validates and enhances blueprint
- Worker creates `api-blueprint.json` file in container
- Worker commits file to git
- Worker stores in database

**Benefits:**
- Safety net if file creation fails
- Validation opportunity before file creation
- Backward compatible with existing system
- Lower risk for critical initial creation

#### Project Modification (AI Modifies File → Worker Extracts)
- AI reads existing `api-blueprint.json` file
- AI modifies file directly with changes
- Worker extracts updated file from container
- Worker stores in database

**Benefits:**
- File already exists, safe to modify directly
- AI has full context from existing file
- Simpler for incremental updates
- Consistent with modification workflow

### 3. Database Schema Change
- Keep `blueprint_content` as `JSONB` to store the full JSON
- Add `last_updated` column (BIGINT) for timestamp tracking
- Remove `lastUpdated` from JSON structure (stored in column instead)
- Primary storage is database, file in repo is for developer access

## JSON Blueprint Schema

### Structure
```json
{
  "endpoints": [
    {
      "id": "endpoint_1",
      "method": "GET",
      "path": "/api/users",
      "description": "Retrieve all users",
      "authentication": "required",
      "requestParams": {
        "query": {
          "page": {
            "type": "integer",
            "required": false,
            "description": "Page number for pagination"
          },
          "limit": {
            "type": "integer",
            "required": false,
            "description": "Number of items per page"
          }
        }
      },
      "requestBody": null,
      "responseSchema": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "name": { "type": "string" },
            "email": { "type": "string" }
          }
        }
      },
      "responseExample": [
        {
          "id": "user_1",
          "name": "John Doe",
          "email": "john@example.com"
        }
      ],
      "errorResponses": [
        {
          "status": 401,
          "description": "Unauthorized - Invalid or missing authentication"
        }
      ]
    },
    {
      "id": "endpoint_2",
      "method": "POST",
      "path": "/api/users",
      "description": "Create a new user",
      "authentication": "required",
      "requestParams": null,
      "requestBody": {
        "type": "object",
        "required": ["name", "email"],
        "properties": {
          "name": {
            "type": "string",
            "description": "User's full name"
          },
          "email": {
            "type": "string",
            "format": "email",
            "description": "User's email address"
          }
        }
      },
      "responseSchema": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "email": { "type": "string" },
          "createdAt": { "type": "integer" }
        }
      },
      "responseExample": {
        "id": "user_2",
        "name": "Jane Smith",
        "email": "jane@example.com",
        "createdAt": 1234567890
      },
      "errorResponses": [
        {
          "status": 400,
          "description": "Bad Request - Invalid input data"
        },
        {
          "status": 401,
          "description": "Unauthorized"
        }
      ]
    }
  ]
}
```

**Note:** Database schema is stored separately in the `project_databases` table and is not included in the API blueprint.

## Database Schema Changes

### Store JSON in Database (Selected Approach)
```sql
-- Modify api_blueprints table
ALTER TABLE turbobackend.api_blueprints 
ALTER COLUMN blueprint_content TYPE JSONB USING blueprint_content::jsonb,
ADD COLUMN last_updated BIGINT;

-- Update existing records
UPDATE turbobackend.api_blueprints 
SET last_updated = created_at 
WHERE last_updated IS NULL;
```

**Updated Schema:**
```
Table: api_blueprints
blueprint_id | varchar | PRIMARY KEY
project_id | varchar | (metadata - stored in column)
request_id | varchar | (metadata - stored in column)
blueprint_content | jsonb | (stores blueprint JSON without metadata)
last_updated | bigint | (metadata - stored in column)
created_at | bigint | (metadata - stored in column)
```

**Note:** Metadata (projectId, projectName, timestamps) is stored in separate columns, not in the JSON. This keeps the blueprint clean and focused on API documentation.

**Why JSONB:**
- Fast access from database
- Can query blueprint data with SQL
- No need to fetch from S3/GitHub
- Supports indexing and JSON operations
- File in repo is for developer convenience

## Implementation

### 1. Make System Prompt Dynamic
**Location**: `worker/llms/prompts/containerAgentSystem.js`

Convert to a function that accepts context:

```javascript
export function getContainerAgentSystemPrompt({ processType = 'creation', projectName = null }) {
  let prompt = `
You are an expert backend developer implementing a user's request in a Nitro.js project inside a Daytona container.
... [existing prompt content] ...
`;

  // Add API Blueprint instructions based on process type
  if (processType === 'modification') {
    prompt += `

## API Blueprint Management (Modification)

This project has an existing API blueprint at: api-blueprint.json

When you add/modify/delete endpoints, you MUST update this file:
1. Read the existing api-blueprint.json file
2. Update the relevant endpoint entries (add/modify/remove)
3. Maintain the existing JSON structure
4. Write the updated JSON back to api-blueprint.json

Do NOT include apiBlueprint in your response - just update the file.
`;
  } else {
    prompt += `

## API Blueprint Creation (Initial Project)

When marking taskComplete as true, you MUST include an 'apiBlueprint' field with a JSON object documenting all API endpoints you created.

The JSON structure should be (do NOT include metadata like projectId, projectName, version, or database schema):
{
  "endpoints": [
    {
      "method": "GET",
      "path": "/api/users",
      "description": "Retrieve all users",
      "authentication": "required",
      "requestParams": { ... },
      "requestBody": null,
      "responseSchema": { ... },
      "responseExample": { ... },
      "errorResponses": [ ... ]
    }
  ]
}

Note: Database schema is stored separately in the project_databases table, not in the blueprint.

The worker will automatically create an api-blueprint.json file from this response.
`;
  }

  return prompt;
}

// Keep backward compatibility
export const CONTAINER_AGENT_SYSTEM_PROMPT = getContainerAgentSystemPrompt({});
```

### 2. Update Project Creation Handler
**Location**: `worker/handlers/projectCreationExecutionHandler.js`

```javascript
// After agentic loop completes
if (agentResult.apiBlueprint) {
  console.log(`[AgenticExecution] Processing API blueprint from AI response`);
  
  // Get blueprint and remove any metadata
  const blueprint = { ...agentResult.apiBlueprint };
  
  // Remove metadata if AI included it (stored in DB instead)
  delete blueprint.projectId;
  delete blueprint.projectName;
  delete blueprint.version;
  delete blueprint.database; // Database schema stored separately
  
  // Write blueprint to file in container
  const blueprintJson = JSON.stringify(blueprint, null, 2);
  await writeFileInContainer(containerId, 'api-blueprint.json', blueprintJson);
  
  console.log(`[AgenticExecution] Created api-blueprint.json file`);
  
  // Commit to git
  await executeCommandInContainer(containerId, 'git add api-blueprint.json');
  await executeCommandInContainer(containerId, 'git commit -m "Add API blueprint"');
  
  // Store in database
  const blueprintId = nanoid();
  const now = Math.floor(Date.now() / 1000);
  
  await client.query(
    `INSERT INTO ${process.env.PG_DB_SCHEMA}.api_blueprints 
     (blueprint_id, project_id, request_id, blueprint_content, last_updated, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [blueprintId, project_id, requestId, JSON.stringify(blueprint), now, now]
  );
  
  console.log(`[AgenticExecution] API blueprint saved: ${blueprintId}`);
  
  // Publish to stream (for immediate display)
  await publishToChannel(
    streamId,
    JSON.stringify({
      type: 'apiBlueprint',
      content: blueprint
    })
  );
}
```

### 3. Update Agentic Loop to Use Dynamic Prompt
**Location**: `worker/llms/agenticLoopExecutor.js`

```javascript
import { getContainerAgentSystemPrompt } from "./prompts/containerAgentSystem.js";

export async function runAgenticLoop({
  containerId,
  projectId,
  userId,
  userRequest,
  requestId,
  databaseSchema = null,
  existingFiles = [],
  existingEndpoints = [],
  projectName = null,
  maxIterations = Infinity
}) {
  // Determine process type
  const processType = existingEndpoints.length > 0 ? 'modification' : 'creation';
  
  // Get dynamic system prompt
  let systemPrompt = getContainerAgentSystemPrompt({ 
    processType, 
    projectName 
  });
  
  // ... rest of implementation
}
```

### 4. Update Project Modification Handler
**Location**: `worker/handlers/projectModificationExecutionHandler.js`

```javascript
// After agentic loop completes
// Check if api-blueprint.json was modified
const blueprintModified = agentResult.filesModified?.some(function(f) {
  return f.path === 'api-blueprint.json';
});

if (blueprintModified) {
  console.log(`[ProjectModification] Extracting updated API blueprint from container`);
  
  // Read the updated blueprint from container
  const blueprintContent = await readFileFromContainer(containerId, 'api-blueprint.json');
  const blueprint = JSON.parse(blueprintContent);
  
  // Update database record
  const now = Math.floor(Date.now() / 1000);
  await client.query(
    `UPDATE ${process.env.PG_DB_SCHEMA}.api_blueprints 
     SET blueprint_content = $1, last_updated = $2
     WHERE project_id = $3`,
    [JSON.stringify(blueprint), now, project_id]
  );
  
  // Publish to stream
  await publishToChannel(
    streamId,
    JSON.stringify({
      type: 'apiBlueprint',
      content: blueprint
    })
  );
  
  console.log(`[ProjectModification] API blueprint updated and published`);
}
```

### 5. Helper Functions for File Operations
**Location**: `worker/services/daytonaService.js`

```javascript
export async function writeFileInContainer(containerId, filePath, content) {
  console.log(`[Daytona] Writing file: ${filePath}`);
  
  // Escape content for heredoc
  const escapedContent = content.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  
  const command = `cat > ${filePath} << 'EOF'\n${escapedContent}\nEOF`;
  
  await executeCommandInContainer(containerId, command);
  
  console.log(`[Daytona] File written: ${filePath}`);
}

export async function readFileFromContainer(containerId, filePath) {
  console.log(`[Daytona] Reading file: ${filePath}`);
  
  const result = await executeCommandInContainer(containerId, `cat ${filePath}`);
  
  return result.result || result.stdout || '';
}
```

Note: `writeFileInContainer` is needed for initial creation. For modifications, AI writes the file directly.

## Database Migration

```sql
-- Convert blueprint_content to JSONB and add last_updated column
ALTER TABLE turbobackend.api_blueprints 
ALTER COLUMN blueprint_content TYPE JSONB USING blueprint_content::jsonb,
ADD COLUMN IF NOT EXISTS last_updated BIGINT;

-- Set last_updated for existing records
UPDATE turbobackend.api_blueprints 
SET last_updated = created_at 
WHERE last_updated IS NULL;
```

## Files to Create/Modify

### New Files:
None (all changes in existing files)

### Modified Files:
1. `worker/llms/prompts/containerAgentSystem.js` - Convert to dynamic function with conditional prompts
2. `worker/llms/agenticLoopExecutor.js` - Use dynamic prompt, pass projectName
3. `worker/handlers/projectCreationExecutionHandler.js` - Create file from AI response, store in DB
4. `worker/handlers/projectModificationExecutionHandler.js` - Extract updated file, update DB
5. `worker/services/daytonaService.js` - Add writeFileInContainer and readFileFromContainer helpers
6. `database-migrations.sql` - Update api_blueprints table schema
7. `technicalContext.txt` - Update api_blueprints table documentation

## Benefits of Hybrid Approach

### Initial Creation (AI Response → Worker Creates File)
1. **Safety Net** - Blueprint preserved even if file creation fails
2. **Validation** - Worker can validate and enhance before writing
3. **Backward Compatible** - Works with existing system
4. **Lower Risk** - Critical first creation has fallback
5. **Control** - Worker has full control over file content

### Modification (AI Modifies File → Worker Extracts)
1. **Direct Updates** - AI modifies file in place
2. **Full Context** - AI reads entire existing blueprint
3. **Incremental** - Only changes what's needed
4. **Consistent** - Same file throughout project lifecycle
5. **Simple** - Straightforward read-modify-write pattern

### JSON Format Benefits
1. **Structured Data** - Easy to parse and validate
2. **Programmatic Access** - Frontend can render API docs
3. **Tooling Integration** - Convert to OpenAPI/Swagger
4. **Version Control** - Clear diffs in git
5. **Extensibility** - Easy to add new fields

## Backend Integration

### Reading Blueprint
```javascript
// Read from database (primary method)
const result = await db.query(
  'SELECT blueprint_content, last_updated FROM api_blueprints WHERE project_id = $1',
  [projectId]
);
const blueprint = result.rows[0].blueprint_content; // Already parsed as JSON (JSONB)
const lastUpdated = result.rows[0].last_updated;

// Blueprint is ready to use - no parsing needed
```

## Activity Tracking

Track blueprint updates:
```javascript
await trackActivity({
  projectId: project_id,
  userId: user_id,
  requestId,
  actionType: 'api_blueprint_updated',
  actionDetails: 'API blueprint updated with new endpoints',
  status: 'success',
  environment: 'development',
  referenceIds: {
    file_path: 'api-blueprint.json',
    blueprint_id: blueprintId
  },
  client
});
```

## Workflow Summary

### Initial Project Creation
1. **AI generates blueprint** - Returns JSON in `apiBlueprint` field (only endpoints)
2. **Worker validates** - Validates structure, removes any metadata/database schema
3. **Worker creates file** - Writes `api-blueprint.json` to container
4. **Worker commits** - Commits file to git
5. **Worker stores** - Saves to database as JSONB (metadata in separate columns)
6. **Worker publishes** - Sends to stream for immediate display

### Project Modification
1. **AI reads file** - Reads existing `api-blueprint.json`
2. **AI modifies file** - Updates endpoints, writes back to file
3. **Worker extracts** - Reads updated file from container
4. **Worker commits** - Commits changes to git (in feature branch)
5. **Worker updates DB** - Updates database record
6. **Worker publishes** - Sends to stream for immediate display

## Error Handling

- Validate JSON structure before writing/storing
- Handle missing blueprint in AI response (initial creation)
- Handle missing blueprint file gracefully (modification)
- Fallback to generating new blueprint if file is corrupted
- Log blueprint parsing errors
- Track failed blueprint operations in activity log

## Testing

1. **Initial Creation**: Verify `api-blueprint.json` is created and committed
2. **Modification**: Verify blueprint is updated when endpoints change
3. **JSON Validation**: Verify blueprint follows schema
4. **Git Integration**: Verify file is tracked in git
5. **Pub/Sub**: Verify blueprint is published to stream

## Future Enhancements

- Auto-generate OpenAPI/Swagger spec from JSON
- Generate Postman collections
- Create API testing suites
- Validate actual API responses against blueprint
- Generate client SDKs
- API versioning support
