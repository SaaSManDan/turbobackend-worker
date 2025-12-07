import {
    BedrockAgentClient,
    StartIngestionJobCommand,
    GetIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';
import {
    BedrockAgentRuntimeClient,
    RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import pool from '../../databases/postgresConnector.js';

// Initialize Bedrock Agent client for sync operations
const bedrockAgentClient = new BedrockAgentClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

// Initialize Bedrock Agent Runtime client for retrieval operations
const bedrockRuntimeClient = new BedrockAgentRuntimeClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

/**
 * Triggers a sync job for the Bedrock Knowledge Base
 * This will re-index all files from the S3 data source
 * Handles ConflictException when a sync is already in progress
 *
 * @param {string} knowledgeBaseId - The Knowledge Base ID (optional, uses env var if not provided)
 * @param {string} dataSourceId - The Data Source ID (optional, uses env var if not provided)
 * @returns {Promise<{jobId: string, status: string, skipped?: boolean}>} - The ingestion job ID and initial status
 */
export async function triggerKnowledgeBaseSync(knowledgeBaseId, dataSourceId) {
    try {
        const kbId = knowledgeBaseId || process.env.BEDROCK_KB_ID;
        const dsId = dataSourceId || process.env.BEDROCK_DATA_SOURCE_ID;

        if (!kbId || !dsId) {
            throw new Error('Knowledge Base ID and Data Source ID are required');
        }

        const command = new StartIngestionJobCommand({
            knowledgeBaseId: kbId,
            dataSourceId: dsId,
        });

        const response = await bedrockAgentClient.send(command);

        console.log(`Bedrock sync job started: ${response.ingestionJob.ingestionJobId}`);

        return {
            jobId: response.ingestionJob.ingestionJobId,
            status: response.ingestionJob.status,
        };
    } catch (error) {
        // Handle ConflictException - sync already in progress
        if (error.name === 'ConflictException' || error.$metadata?.httpStatusCode === 409) {
            console.log('Bedrock sync already in progress, skipping duplicate sync request');
            return {
                jobId: null,
                status: 'ALREADY_IN_PROGRESS',
                skipped: true,
            };
        }

        console.error('Error triggering Bedrock Knowledge Base sync:', error);
        throw new Error(`Bedrock sync failed: ${error.message}`);
    }
}

/**
 * Gets the status of a Bedrock Knowledge Base ingestion job
 *
 * @param {string} jobId - The ingestion job ID
 * @param {string} knowledgeBaseId - The Knowledge Base ID (optional, uses env var if not provided)
 * @param {string} dataSourceId - The Data Source ID (optional, uses env var if not provided)
 * @returns {Promise<{status: string, statistics: object}>} - The job status and statistics
 */
export async function getSyncJobStatus(jobId, knowledgeBaseId, dataSourceId) {
    try {
        const kbId = knowledgeBaseId || process.env.BEDROCK_KB_ID;
        const dsId = dataSourceId || process.env.BEDROCK_DATA_SOURCE_ID;

        if (!kbId || !dsId || !jobId) {
            throw new Error('Knowledge Base ID, Data Source ID, and Job ID are required');
        }

        const command = new GetIngestionJobCommand({
            knowledgeBaseId: kbId,
            dataSourceId: dsId,
            ingestionJobId: jobId,
        });

        const response = await bedrockAgentClient.send(command);

        return {
            status: response.ingestionJob.status,
            statistics: response.ingestionJob.statistics || {},
            startedAt: response.ingestionJob.startedAt,
            updatedAt: response.ingestionJob.updatedAt,
        };
    } catch (error) {
        console.error('Error getting Bedrock sync job status:', error);
        throw new Error(`Failed to get sync status: ${error.message}`);
    }
}

/**
 * Waits for a sync job to complete (polling)
 *
 * @param {string} jobId - The ingestion job ID
 * @param {number} maxWaitTime - Maximum time to wait in milliseconds (default: 5 minutes)
 * @param {number} pollInterval - Polling interval in milliseconds (default: 10 seconds)
 * @returns {Promise<{status: string, statistics: object}>} - The final job status
 */
export async function waitForSyncCompletion(jobId, maxWaitTime = 300000, pollInterval = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
        const jobStatus = await getSyncJobStatus(jobId);

        if (jobStatus.status === 'COMPLETE') {
            console.log(`Bedrock sync job ${jobId} completed successfully`);
            return jobStatus;
        }

        if (jobStatus.status === 'FAILED') {
            throw new Error(`Bedrock sync job ${jobId} failed`);
        }

        // Status is still IN_PROGRESS, wait and poll again
        await new Promise(function(resolve) {
            setTimeout(resolve, pollInterval);
        });
    }

    throw new Error(`Bedrock sync job ${jobId} timed out after ${maxWaitTime}ms`);
}

/**
 * Queries the Bedrock Knowledge Base for relevant code chunks using semantic search
 * Replaces direct Pinecone queries - Bedrock handles embedding generation and vector search
 *
 * @param {string} queryText - The semantic query text (no need for pre-generated embeddings)
 * @param {string} projectId - Project ID to filter results (uses metadata filtering)
 * @param {number} topK - Number of results to return (default: 10)
 * @param {string} knowledgeBaseId - The Knowledge Base ID (optional, uses env var if not provided)
 * @returns {Promise<Array>} - Array of matching results with metadata and scores
 */
export async function queryKnowledgeBase(queryText, projectId, topK = 10, knowledgeBaseId) {
    try {
        const kbId = knowledgeBaseId || process.env.BEDROCK_KB_ID;

        if (!kbId) {
            throw new Error('Knowledge Base ID is required');
        }

        console.log(`[BedrockRetrieve] Querying KB for project: ${projectId}, query: "${queryText}"`);

        // Build the Retrieve command with metadata filtering
        // Filters by projectId using .metadata.json files stored alongside source files in S3
        const command = new RetrieveCommand({
            knowledgeBaseId: kbId,
            retrievalQuery: {
                text: queryText,
            },
            retrievalConfiguration: {
                vectorSearchConfiguration: {
                    numberOfResults: topK,
                    // Filter by projectId metadata attribute
                    filter: {
                        equals: {
                            key: 'projectid',
                            value: projectId,
                        },
                    },
                },
            },
        });

        // Execute the retrieve command
        const response = await bedrockRuntimeClient.send(command);

        // Extract S3 keys from results and build a mapping
        // Bedrock returns S3 URIs like: s3://bucket-name/proj_abc123xyz/path/to/file.js
        const s3Keys = [];
        const s3UriToResult = new Map();

        for (const result of response.retrievalResults || []) {
            const s3Uri = result.location?.s3Location?.uri;
            if (s3Uri) {
                // Extract S3 key from URI (remove s3://bucket-name/ prefix)
                // URI format: s3://devdocsflow2-project-files-dev/proj_abc123xyz/app/api/route.js
                const s3Key = s3Uri.replace(/^s3:\/\/[^/]+\//, '');
                s3Keys.push(s3Key);
                s3UriToResult.set(s3Uri, result);
            }
        }

        // Query database to get file metadata based on S3 keys
        const fileMetadataMap = new Map();
        if (s3Keys.length > 0) {
            const query = `
                SELECT file_id, file_path, file_name, language, s3_key
                FROM ${process.env.PG_DB_SCHEMA}.project_code_files
                WHERE project_id = $1 AND s3_key = ANY($2)
            `;
            const dbResult = await pool.query(query, [projectId, s3Keys]);

            // Build map of s3_key -> file metadata
            for (const row of dbResult.rows) {
                fileMetadataMap.set(row.s3_key, {
                    file_id: row.file_id,
                    file_path: row.file_path,
                    file_name: row.file_name,
                    language: row.language,
                });
            }
        }

        // Transform Bedrock response to match the format expected by contextRetrieval.js
        const results = (response.retrievalResults || []).map(function(result) {
            const s3Uri = result.location?.s3Location?.uri;
            const s3Key = s3Uri ? s3Uri.replace(/^s3:\/\/[^/]+\//, '') : null;
            const fileMetadata = s3Key ? fileMetadataMap.get(s3Key) : null;

            return {
                // Extract metadata from database lookup
                metadata: {
                    file_id: fileMetadata?.file_id || null,
                    file_path: fileMetadata?.file_path || null,
                    file_name: fileMetadata?.file_name || null,
                    language: fileMetadata?.language || null,
                    project_id: projectId,
                },
                // Score represents relevance (higher is more relevant)
                score: result.score || 0,
                // Content of the chunk (for reference)
                content: result.content?.text || '',
                // S3 location reference
                location: result.location,
            };
        });

        console.log(`[BedrockRetrieve] Retrieved ${results.length} results`);

        return results;
    } catch (error) {
        console.error('[BedrockRetrieve] Error querying Knowledge Base:', error);
        throw new Error(`Bedrock retrieve failed: ${error.message}`);
    }
}
