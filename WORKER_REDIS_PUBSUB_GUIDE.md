# Worker Redis Pub/Sub Setup Guide

This document explains how the worker should publish progress updates and results back to the backend via Redis pub/sub.

## Overview

When the backend receives an MCP tool call, it:
1. Creates a unique `streamId` (nanoid)
2. Enqueues a job with the `streamId` in the job data
3. Subscribes to Redis channel named `streamId`
4. Waits for messages from the worker

The worker must publish messages to this Redis channel to send progress updates and final results.

## Job Data Structure

The worker receives jobs with this data:
```javascript
{
  project_id: "abc123",
  user_id: "user_xyz",
  request_id: "req_123",
  toolName: "spin_up_new_backend_project",
  params: {
    // Tool-specific parameters
  }
}
```

The `streamId` is passed separately (check your job queue implementation for how it's passed - might be in job metadata or as a separate field).

## Required: Redis Publisher Setup

The worker needs:
1. A Redis client configured to publish messages
2. Access to the same Redis instance as the backend
3. The `streamId` from the job data

## Message Format

### Progress Updates

Send progress updates as JSON to the Redis channel:

```javascript
await redis.publish(streamId, JSON.stringify({
  message: "Creating project structure...",
  progress: 25
}));
```

**Fields:**
- `message` (string): Human-readable progress message
- `progress` (number): Progress percentage (0-100)

### Final Result (Success)

When the job completes successfully:

```javascript
await redis.publish(streamId, JSON.stringify({
  complete: true,
  content: "Project created successfully! Files generated: ...",
  isError: false
}));
```

**Fields:**
- `complete` (boolean): Must be `true`
- `content` (string): Final result message to show the user
- `isError` (boolean): Must be `false` for success

### Final Result (Error)

When the job fails:

```javascript
await redis.publish(streamId, JSON.stringify({
  complete: true,
  content: "Failed to create project: [error details]",
  isError: true
}));
```

**Fields:**
- `complete` (boolean): Must be `true`
- `content` (string): Error message to show the user
- `isError` (boolean): Must be `true` for errors

## Example Worker Implementation

```javascript
// In your worker job handler
async function handleJob(job) {
  const { project_id, user_id, request_id, toolName, params } = job.data;
  const streamId = job.streamId; // Or however you pass it
  
  try {
    // Send initial progress
    await redis.publish(streamId, JSON.stringify({
      message: "Starting job...",
      progress: 0
    }));
    
    // Do some work
    await doSomeWork();
    
    // Send progress update
    await redis.publish(streamId, JSON.stringify({
      message: "Half way done...",
      progress: 50
    }));
    
    // Do more work
    await doMoreWork();
    
    // Send final success
    await redis.publish(streamId, JSON.stringify({
      complete: true,
      content: "Job completed successfully!",
      isError: false
    }));
    
  } catch (error) {
    // Send error result
    await redis.publish(streamId, JSON.stringify({
      complete: true,
      content: `Job failed: ${error.message}`,
      isError: true
    }));
  }
}
```

## Important Notes

1. **Always send a final message** with `complete: true` - otherwise the backend will wait forever
2. **Progress updates are optional** but recommended for long-running jobs
3. **The channel name is the streamId** - make sure you're publishing to the correct channel
4. **Messages must be valid JSON strings** - use `JSON.stringify()`
5. **The backend expects these exact field names** - don't change them

## Testing

To test if pub/sub is working:

1. Start your backend server
2. Make an MCP tool call
3. Check backend logs for "Job queue error" or "Error parsing Redis message"
4. Check worker logs to ensure it's publishing messages
5. Use Redis CLI to monitor: `redis-cli MONITOR` to see all pub/sub activity

## Checklist

- [ ] Worker has Redis client configured
- [ ] Worker can access the `streamId` from job data
- [ ] Worker publishes progress updates in correct format
- [ ] Worker publishes final result with `complete: true`
- [ ] Worker handles errors and publishes error result
- [ ] Tested with a real MCP tool call
