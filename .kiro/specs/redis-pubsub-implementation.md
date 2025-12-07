# Redis Pub/Sub Implementation Plan

## Overview
Implement Redis pub/sub pattern to send progress updates and final results from worker to backend during MCP tool execution.

## Prerequisites
- `streamId` is already being passed in job data from backend
- Redis connection and publisher already exist in `worker/pubsub-handlers.js`

## Implementation Steps

### Step 1: Create New Pub/Sub Helper Functions
**File:** `worker/pubsub-handlers.js`

Add three new functions:
- `publishProgress(streamId, message, progress)` - Publishes progress updates
  - Format: `{ message: string, progress: number }`
  - Progress should be 0-100
- `publishSuccess(streamId, content)` - Publishes final success result
  - Format: `{ complete: true, content: string, isError: false }`
- `publishError(streamId, content)` - Publishes final error result
  - Format: `{ complete: true, content: string, isError: true }`

All should use existing `publishToChannel` function and `JSON.stringify` the payload.

### Step 2: Extract streamId in mcpRequestProcessor
**File:** `worker/processors/mcpRequestProcessor.js`

- Extract `streamId` from `job.data`
- Pass `streamId` as parameter to `handleAgenticExecution(job, requestId, streamId)`

### Step 3: Add Progress Updates in agenticExecutionHandler
**File:** `worker/handlers/agenticExecutionHandler.js`

Add progress updates at key phases:
- Initial start: 10% - "Starting execution..."
- After container provisioning: 20% - "Container provisioned"
- Before agentic loop: 30% - "Starting agentic loop"
- After agentic loop: 70% - "Agentic loop complete"
- After GitHub push: 80% - "Code pushed to GitHub"
- After S3 upload: 90% - "Files uploaded to S3"
- After deployment: 95% - "Deployment complete"

### Step 4: Add Final Success Message
**File:** `worker/handlers/agenticExecutionHandler.js`

Before returning the result object, call `publishSuccess` with formatted content:
- Include number of files modified
- Include deployment URL if available
- Include database queries executed if any
- Include total cost
- Include summary from agent

### Step 5: Add Error Handling
**File:** `worker/handlers/agenticExecutionHandler.js`

In the catch block:
- Call `publishError` with error message
- Include context about which phase failed
- Still re-throw the error after publishing

### Step 6: Optional - Granular Progress in Agentic Loop
**File:** `worker/llms/agenticLoopExecutor.js`

If desired, add progress updates during iterations:
- Accept `streamId` as parameter
- Calculate progress between 30-70% based on current iteration
- Publish after each iteration completes

## Testing Checklist
- [ ] Progress messages appear during execution
- [ ] Final success message arrives with correct format
- [ ] Error messages work when execution fails
- [ ] Backend receives all messages on correct channel
- [ ] Use Redis CLI `MONITOR` to verify pub/sub activity
- [ ] Test with actual MCP tool call end-to-end

## Critical Requirements
- Every execution path MUST end with either `publishSuccess` or `publishError`
- Messages must be valid JSON strings
- Channel name is the `streamId` from job data
- Field names must match exactly: `message`, `progress`, `complete`, `content`, `isError`
