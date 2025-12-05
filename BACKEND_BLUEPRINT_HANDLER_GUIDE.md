# Backend API Blueprint Handler Guide

## Overview
The worker now publishes API blueprint messages to Redis during MCP tool execution. The backend needs to handle these messages separately from progress updates and include them in the final response to the MCP client.

## Message Format

### API Blueprint Message
When the worker generates an API blueprint, it publishes this message to the `streamId` channel:

```json
{
  "type": "apiBlueprint",
  "content": "# API Blueprint\n\n## Endpoints\n\n### GET /api/users\n..."
}
```

**Fields:**
- `type` (string): Always `"apiBlueprint"` for blueprint messages
- `content` (string): Markdown-formatted API documentation

### Existing Message Formats
For reference, here are the other message types:

**Progress Update:**
```json
{
  "message": "Creating project structure...",
  "progress": 25
}
```

**Final Success:**
```json
{
  "complete": true,
  "content": "Project created successfully!",
  "isError": false
}
```

**Final Error:**
```json
{
  "complete": true,
  "content": "Failed to create project: [error details]",
  "isError": true
}
```

## Backend Implementation Requirements

### Step 1: Update Message Parser
In your Redis subscriber handler, update the message parsing logic to detect the `type` field.

When parsing incoming messages:
1. Check if message has `type: "apiBlueprint"`
2. If yes, store the blueprint content separately
3. Continue listening for other messages (progress, completion)

### Step 2: Store Blueprint Separately
Create a variable to hold the blueprint content while the job is running:

```javascript
let apiBlueprint = null;

// When blueprint message arrives:
if (message.type === 'apiBlueprint') {
  apiBlueprint = message.content;
}
```

### Step 3: Include Blueprint in MCP Response
When the final completion message arrives (`complete: true`), include the blueprint in your response to the MCP client.

**Suggested Response Format:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Project created successfully! Files generated: ..."
    },
    {
      "type": "resource",
      "resource": {
        "uri": "blueprint://api-documentation",
        "mimeType": "text/markdown",
        "text": "<blueprint markdown content>"
      }
    }
  ]
}
```

Or simpler format:
```json
{
  "success": true,
  "message": "Project created successfully!",
  "apiBlueprint": "<blueprint markdown content>"
}
```

### Step 4: Handle Missing Blueprint
Not all MCP tool executions will generate a blueprint (only those that create APIs). Handle the case where no blueprint is published:

- If no blueprint message received, don't include it in response
- Don't wait indefinitely for a blueprint
- Only the final completion message is guaranteed

## Message Flow Diagram

```
Worker                    Redis                    Backend
  |                        |                         |
  |-- Progress Update ---->|------------------------>|
  |                        |                         |
  |-- API Blueprint ------>|------------------------>| (Store separately)
  |                        |                         |
  |-- Progress Update ---->|------------------------>|
  |                        |                         |
  |-- Final Success ------>|------------------------>| (Include blueprint in response)
  |                        |                         |
```

## Example Backend Handler (Pseudocode)

```javascript
// Subscribe to streamId channel
redis.subscribe(streamId);

let progressUpdates = [];
let apiBlueprint = null;

redis.on('message', (channel, message) => {
  const data = JSON.parse(message);
  
  // Handle different message types
  if (data.type === 'apiBlueprint') {
    // Store blueprint
    apiBlueprint = data.content;
    console.log('Received API blueprint');
  } 
  else if (data.complete) {
    // Final message - send response to MCP client
    const response = {
      success: !data.isError,
      message: data.content,
      progressUpdates: progressUpdates
    };
    
    // Include blueprint if it exists
    if (apiBlueprint) {
      response.apiBlueprint = apiBlueprint;
    }
    
    sendToMCPClient(response);
    redis.unsubscribe(streamId);
  } 
  else if (data.message && data.progress !== undefined) {
    // Progress update
    progressUpdates.push(data);
    console.log(`Progress: ${data.progress}% - ${data.message}`);
  }
});
```

## Testing

### Test Blueprint Reception
1. Start backend server
2. Make an MCP tool call that creates API endpoints
3. Monitor Redis messages: `redis-cli MONITOR`
4. Verify you see a message with `type: "apiBlueprint"`
5. Verify backend logs show blueprint received
6. Verify final MCP response includes the blueprint

### Test Without Blueprint
1. Make an MCP tool call that doesn't create APIs
2. Verify backend doesn't wait for blueprint
3. Verify final response works without blueprint field

## Important Notes

1. **Blueprint is optional** - Not all executions will generate one
2. **Blueprint comes before completion** - Always arrives before the final success/error message
3. **Only one blueprint per execution** - You'll receive at most one blueprint message
4. **Markdown format** - The content is always markdown text
5. **Don't block on blueprint** - Only wait for the completion message

## Checklist

- [ ] Backend can parse messages with `type` field
- [ ] Blueprint messages are stored separately
- [ ] Blueprint is included in MCP response when present
- [ ] Backend doesn't break when no blueprint is sent
- [ ] Tested with actual MCP tool call
- [ ] IDE receives and can display the blueprint
- [ ] Redis message monitoring shows correct format
