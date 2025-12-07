// In utils/updateInitialProjectProgress.js

import { redis } from '../databases/redisConnector.js';

export default async function updateInitialProjectProgress(progressStatus, jobId) {
    const progressKey = `job-progress:${jobId}:progressStatus`;
    const timestamp = new Date().toISOString();
    
    // Store the state as a field in the hash
    // Field name is the state, value is timestamp when it was set to true
    await redis.hset(progressKey, progressStatus, timestamp);
    
    // Set expiration (24 hours) - only needs to be set once
    await redis.expire(progressKey, 86400);
}