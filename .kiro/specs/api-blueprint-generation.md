# API Blueprint Generation Implementation Plan

## Overview
After the AI agent completes creating API endpoints, it should generate a markdown-formatted API blueprint documenting all endpoints. This blueprint will be stored in the database and streamed back to the backend/IDE for immediate use.

## Implementation Steps

### Step 1: Modify Agent System Prompt
**File:** `worker/llms/prompts/containerAgentSystem.js`

Update the prompt to instruct the AI that when setting `taskComplete: true`, it must include an `apiBlueprint` field in the JSON response.

**Blueprint Requirements:**
- Markdown-formatted string
- Document all API endpoints created
- Include for each endpoint:
  - HTTP method (GET, POST, PUT, DELETE, PATCH, etc.)
  - Endpoint path
  - Request parameters/body schema
  - Response format/schema
  - Authentication requirements (if any)
  - Brief description of functionality


### Step 2: Update Output Format in Prompt
**File:** `worker/llms/prompts/containerAgentSystem.js`

Modify the JSON output format section to show the new structure when `taskComplete: true`:

```json
{
  "reasoning": "All endpoints implemented and tested",
  "commands": [],
  "taskComplete": true,
  "summary": "Created 5 API endpoints for user management",
  "apiBlueprint": "# API Blueprint\n\n## Endpoints\n\n### GET /api/users\n..."
}
```

### Step 3: Extract Blueprint in Agentic Loop
**File:** `worker/llms/agenticLoopExecutor.js`

When the agent marks `taskComplete: true`, extract the `apiBlueprint` field from `agentResponse`.

Add to the return object (around line 90):
- `apiBlueprint: agentResponse.apiBlueprint || null`

### Step 4: Create Database Table
**Files:** `database-migrations.sql` and `technicalContext.txt`

Create new Postgres table `api_blueprints`:

**Columns:**
- `blueprint_id` (varchar, primary key) - nanoid
- `project_id` (varchar, foreign key to projects table)
- `request_id` (varchar, foreign key to mcp_requests table)
- `blueprint_content` (text) - the markdown content
- `created_at` (bigint) - unix timestamp in seconds


### Step 5: Save Blueprint to Database
**File:** `worker/handlers/agenticExecutionHandler.js`

After the agentic loop completes (around line 30), check if `agentResult.apiBlueprint` exists.

If it does:
- Generate a `blueprint_id` using nanoid
- Insert into `api_blueprints` table within the existing transaction
- Store `project_id`, `request_id`, `blueprint_content`, and `created_at`
- Log the blueprint_id for tracking

### Step 6: Stream Blueprint to Backend
**File:** `worker/handlers/agenticExecutionHandler.js`

Before calling `publishSuccess`, if blueprint exists, publish it as a separate message:

Use the new `publishToChannel` function with format:
```json
{
  "type": "apiBlueprint",
  "content": "<markdown blueprint content>"
}
```

This allows the backend to distinguish blueprint messages from progress updates and completion messages.

### Step 7: Include Blueprint in Success Message
**File:** `worker/handlers/agenticExecutionHandler.js`

In the final success message (around line 70), add a note about the blueprint:
- Mention that API blueprint was generated
- Include blueprint_id for reference
- Optionally include a preview (first 200 characters)

### Step 8: Update Backend Handler
**Note:** This is for the backend team (see separate guide)

The backend needs to:
- Listen for messages with `type: "apiBlueprint"`
- Store blueprint separately from progress updates
- Include blueprint in final MCP response
- Make it available to the IDE AI

## Database Schema

```sql
CREATE TABLE turbobackend.api_blueprints (
  blueprint_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  request_id VARCHAR,
  blueprint_content TEXT,
  created_at BIGINT
);

```

## Message Flow

1. Agent completes task → includes `apiBlueprint` in response
2. Agentic loop extracts blueprint → returns in result
3. Handler saves blueprint to database
4. Handler publishes blueprint message to Redis (streamId channel)
5. Backend receives blueprint message → stores separately
6. Handler publishes final success message
7. Backend includes blueprint in MCP response
8. IDE receives blueprint for AI context

## Testing Checklist
- [ ] Agent generates blueprint when taskComplete is true
- [ ] Blueprint is properly formatted markdown
- [ ] Blueprint is saved to database with correct fields
- [ ] Blueprint message is published to Redis
- [ ] Backend receives and handles blueprint message
- [ ] Blueprint is included in final MCP response
- [ ] IDE can access and use the blueprint
- [ ] Database queries work for retrieving blueprints by project_id
