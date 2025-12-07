import { handleProjectCreationOrchestration } from "../handlers/projectCreationExecutionHandler.js";
import pool from "../../databases/postgresConnector.js";
import { nanoid } from "nanoid";

export async function initialProjectCreationProcessor(job) {
  const { mcp_key_id, tool_name, request_params, user_id, project_id, streamId } = job.data;
  
  console.log(`[initialProjectCreation] Processing job ${job.id}`);
  console.log(`[initialProjectCreation] Tool: ${tool_name}, Project: ${project_id}`);
  console.log(`[initialProjectCreation] StreamId: ${streamId}`);
  
  // Log request to DB
  const requestId = await logMCPRequest(mcp_key_id, tool_name, request_params);
  
  // All initial project creation requests go through the agentic handler
  return await handleProjectCreationOrchestration(job, requestId, streamId);
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
    
    console.log(`[initialProjectCreation] Logged request: ${requestId}`);
    
    return requestId;
  } finally {
    client.release();
  }
}
