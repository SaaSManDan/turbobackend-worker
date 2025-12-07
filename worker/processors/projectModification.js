import { handleProjectModificationOrchestration } from "../handlers/projectModificationExecutionHandler.js";
import pool from "../../databases/postgresConnector.js";
import { nanoid } from "nanoid";

export async function projectModificationProcessor(job) {
    const { mcp_key_id, tool_name, request_params, user_id, project_id, streamId } =
        job.data;

    console.log(`[ProjectModification] Processing job ${job.id}`);
    console.log(
        `[ProjectModification] Tool: ${tool_name}, Project: ${project_id}`,
    );
    console.log(
        `[ProjectModification] Modification request: ${request_params.modificationRequest}`,
    );

    // Log request to DB
    const requestId = await logMCPRequest(
        mcp_key_id,
        tool_name,
        request_params,
    );

    // Handle modification through orchestration handler
    return await handleProjectModificationOrchestration(
        job,
        requestId,
        streamId,
    );
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
            [
                requestId,
                mcpKeyId,
                toolName,
                JSON.stringify(requestParams),
                "processing",
                now,
            ],
        );

        return requestId;
    } finally {
        client.release();
    }
}
