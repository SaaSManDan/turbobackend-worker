import { Pinecone } from '@pinecone-database/pinecone';

// Initialize Pinecone client with API key from environment variables
const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
});

// Get the index name from environment variables
const indexName = process.env.PINECONE_INDEX_NAME;
console.log(`[Pinecone] Using index: ${indexName}`);

/**
 * Stores a code embedding vector in Pinecone with metadata
 * DEPRECATED: Use upsertChunkedEmbeddings for new implementations
 *
 * @param {string} fileId - Unique identifier for the file
 * @param {Array<number>} embedding - The embedding vector (array of floats)
 * @param {object} metadata - Metadata to store with the embedding
 * @param {string} metadata.projectId - Project ID
 * @param {string} metadata.filePath - File path
 * @param {string} metadata.fileName - File name
 * @param {string} metadata.language - Programming language
 * @returns {Promise<void>}
 */
export async function upsertEmbedding(fileId, embedding, metadata) {
    try {
        // Get the Pinecone index
        const index = pinecone.index(indexName);

        // Use projectId as namespace for data isolation
        // This allows querying embeddings per project efficiently
        const namespace = index.namespace(metadata.projectId);

        // Prepare the vector record for upsert
        const vectorRecord = {
            id: fileId, // Unique file ID
            values: embedding, // The embedding vector array
            metadata: {
                file_path: metadata.filePath,
                file_name: metadata.fileName,
                language: metadata.language,
                project_id: metadata.projectId,
            },
        };

        // Upsert the vector into Pinecone
        // Upsert = Insert if new, Update if exists
        await namespace.upsert([vectorRecord]);

        console.log(`Embedding upserted to Pinecone: ${fileId}`);
    } catch (error) {
        console.error('Error upserting embedding to Pinecone:', error);
        throw new Error(`Pinecone upsert failed: ${error.message}`);
    }
}

/**
 * Stores chunked code embeddings in Pinecone with metadata
 * Handles large files by storing multiple embedding chunks per file
 *
 * @param {string} fileId - Unique identifier for the file
 * @param {Array<object>} chunks - Array of chunk objects with content and metadata
 * @param {Array<Array<number>>} embeddings - Array of embedding vectors (one per chunk)
 * @param {object} metadata - File-level metadata
 * @param {string} metadata.projectId - Project ID
 * @param {string} metadata.filePath - File path
 * @param {string} metadata.fileName - File name
 * @param {string} metadata.language - Programming language
 * @returns {Promise<void>}
 */
export async function upsertChunkedEmbeddings(fileId, chunks, embeddings, metadata) {
    try {
        // Get the Pinecone index
        const index = pinecone.index(indexName);

        // Use projectId as namespace for data isolation
        const namespace = index.namespace(metadata.projectId);

        // For updates: try to delete existing chunks (assume max 100 chunks per file)
        // We generate potential IDs and delete them - Pinecone ignores non-existent IDs
        try {
            const potentialIds = [];
            for (let i = 0; i < 100; i++) {
                potentialIds.push(`${fileId}_chunk_${i}`);
            }
            await namespace.deleteMany(potentialIds);
        } catch (deleteError) {
            // Ignore - this is just cleanup for updates
        }

        // Prepare vector records for all chunks
        const vectorRecords = chunks.map((chunk, index) => ({
            id: `${fileId}_chunk_${chunk.chunkIndex}`,
            values: embeddings[index],
            metadata: {
                file_id: fileId,
                project_id: metadata.projectId,
                file_path: metadata.filePath,
                file_name: metadata.fileName,
                language: metadata.language,
                chunk_index: chunk.chunkIndex,
                total_chunks: chunk.totalChunks,
                start_char: chunk.startChar,
                end_char: chunk.endChar,
                content: chunk.content.substring(0, 30000) // Pinecone metadata limit: 40KB, truncate to be safe
            }
        }));

        // Upsert all chunks in a single batch operation
        await namespace.upsert(vectorRecords);

        console.log(`${chunks.length} embedding chunks upserted to Pinecone for file: ${fileId}`);
    } catch (error) {
        console.error('Error upserting chunked embeddings to Pinecone:', error);
        throw new Error(`Pinecone chunked upsert failed: ${error.message}`);
    }
}

/**
 * Queries Pinecone for similar embeddings (semantic search)
 *
 * @param {Array<number>} queryEmbedding - The query embedding vector
 * @param {string} projectId - Project ID to search within (namespace)
 * @param {number} topK - Number of results to return (default: 10)
 * @param {object} filter - Optional metadata filter
 * @returns {Promise<Array>} - Array of matching vectors with scores
 */
export async function queryEmbeddings(queryEmbedding, projectId, topK = 10, filter = {}) {
    try {
        // Get the Pinecone index
        const index = pinecone.index(indexName);

        // Query within the project's namespace
        const namespace = index.namespace(projectId);

        // Execute the query
        const queryResponse = await namespace.query({
            vector: queryEmbedding,
            topK: topK,
            includeMetadata: true, // Include metadata in results
            filter: filter, // Optional: filter by metadata (e.g., language: 'javascript')
        });

        console.log(`Pinecone query returned ${queryResponse.matches.length} results`);

        return queryResponse.matches;
    } catch (error) {
        console.error('Error querying Pinecone:', error);
        throw new Error(`Pinecone query failed: ${error.message}`);
    }
}

/**
 * Deletes an embedding from Pinecone
 * Handles both single embeddings and chunked embeddings
 *
 * @param {string} fileId - The file ID to delete
 * @param {string} projectId - Project ID (namespace)
 * @returns {Promise<void>}
 */
export async function deleteEmbedding(fileId, projectId) {
    try {
        // Get the Pinecone index
        const index = pinecone.index(indexName);

        // Delete from the project's namespace
        const namespace = index.namespace(projectId);

        // Delete all chunks for this file using metadata filter
        // This will delete both old single embeddings (by ID) and new chunked embeddings (by file_id metadata)
        await namespace.deleteMany({
            filter: { file_id: { $eq: fileId } }
        });

        // Also try to delete the old-style single embedding (for backwards compatibility)
        // This will silently fail if it doesn't exist, which is fine
        try {
            await namespace.deleteOne(fileId);
        } catch (legacyDeleteError) {
            // Ignore errors from trying to delete non-existent single embedding
        }

        console.log(`Embedding(s) deleted from Pinecone: ${fileId}`);
    } catch (error) {
        console.error('Error deleting embedding from Pinecone:', error);
        throw new Error(`Pinecone delete failed: ${error.message}`);
    }
}
