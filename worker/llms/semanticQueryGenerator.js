import { callLLMNonStream } from "./xai-non-stream.js";
import {
    getSemanticQueryPrompt,
    getContextReviewPrompt,
    getFinalResponsePrompt
} from "./prompts/contextRetrievalPrompt.js";

/**
 * Generates semantic query parameters from a user's feature request.
 * The LLM interprets the request and outputs optimized search parameters
 * for querying the RAG system.
 *
 * @param {string} userRequest - The user's feature request (e.g., "I want to build payment integration")
 * @returns {Promise<Object>} - Object with semantic_query, file_patterns, top_k
 */
export async function generateSemanticQuery(userRequest) {
    try {
        console.log(`[SemanticQueryGenerator] Generating query for: "${userRequest}"`);

        // Get the system prompt that instructs LLM how to generate search parameters
        const systemPrompt = getSemanticQueryPrompt();

        // Call LLM to interpret the user request and generate search parameters
        const result = await callLLMNonStream(userRequest, systemPrompt);

        // Parse the JSON response from the LLM
        const queryParams = JSON.parse(result.text);

        console.log(`[SemanticQueryGenerator] Generated query: "${queryParams.semantic_query}"`);
        console.log(`[SemanticQueryGenerator] File patterns: ${JSON.stringify(queryParams.file_patterns || [])}`);
        console.log(`[SemanticQueryGenerator] Top K: ${queryParams.top_k || 10}`);

        return {
            semantic_query: queryParams.semantic_query,
            file_patterns: queryParams.file_patterns || [],
            top_k: queryParams.top_k || 10
        };
    } catch (error) {
        console.error('[SemanticQueryGenerator] Error generating semantic query:', error);
        throw new Error(`Semantic query generation failed: ${error.message}`);
    }
}

/**
 * Reviews RAG/AST/dependency graph results and decides next action.
 * The LLM determines which files to fetch from S3 or whether to retry search.
 *
 * @param {string} userRequest - The original user request
 * @param {Array} ragResults - Results from Pinecone query with file metadata
 * @param {Object} astData - AST data for matched files (keyed by file_id)
 * @param {Object} dependencyGraph - Dependency relationships for matched files
 * @param {number} iteration - Current iteration number (for logging)
 * @returns {Promise<Object>} - Object with action ("fetch_files" or "retry_search") and parameters
 */
export async function reviewContextResults(userRequest, ragResults, astData, dependencyGraph, iteration) {
    try {
        console.log(`[SemanticQueryGenerator] Reviewing context (iteration ${iteration})`);

        // Get the system prompt for context review
        const systemPrompt = getContextReviewPrompt();

        // Build the context message for the LLM to review
        const contextMessage = buildContextReviewMessage(userRequest, ragResults, astData, dependencyGraph);

        // Call LLM to review and decide next action
        const result = await callLLMNonStream(contextMessage, systemPrompt);

        // Parse the JSON response
        const decision = JSON.parse(result.text);

        console.log(`[SemanticQueryGenerator] Decision: ${decision.action}`);
        console.log(`[SemanticQueryGenerator] Reasoning: ${decision.reasoning}`);

        return decision;
    } catch (error) {
        console.error('[SemanticQueryGenerator] Error reviewing context:', error);
        throw new Error(`Context review failed: ${error.message}`);
    }
}

/**
 * Generates the final response using full code context.
 * The LLM receives the complete files and answers the user's original request.
 *
 * @param {string} userRequest - The original user request
 * @param {Array} codeFiles - Array of file objects with path, content, ast, dependencies
 * @param {Object} dependencyGraph - Full dependency graph for context
 * @returns {Promise<string>} - The LLM's response to the user
 */
export async function generateFinalResponse(userRequest, codeFiles, dependencyGraph) {
    try {
        console.log(`[SemanticQueryGenerator] Generating final response with ${codeFiles.length} files`);

        // Get the system prompt for final response generation
        const systemPrompt = getFinalResponsePrompt();

        // Build the full context message with code files
        const contextMessage = buildFinalContextMessage(userRequest, codeFiles, dependencyGraph);

        // Call LLM to generate the final response
        const result = await callLLMNonStream(contextMessage, systemPrompt);

        console.log(`[SemanticQueryGenerator] Final response generated (${result.text.length} chars)`);

        return result.text;
    } catch (error) {
        console.error('[SemanticQueryGenerator] Error generating final response:', error);
        throw new Error(`Final response generation failed: ${error.message}`);
    }
}

/**
 * Builds the message for context review containing RAG results, AST, and dependencies.
 * This is sent to the LLM for it to decide which files to fetch.
 */
function buildContextReviewMessage(userRequest, ragResults, astData, dependencyGraph) {
    // Format RAG results showing file paths and relevance scores
    const ragSection = ragResults.map(function(result) {
        return {
            file_id: result.metadata.file_id,
            file_path: result.metadata.file_path,
            file_name: result.metadata.file_name,
            score: result.score,
            language: result.metadata.language
        };
    });

    // Format AST data showing structure of each file
    const astSection = {};
    for (const fileId in astData) {
        const ast = astData[fileId];
        astSection[fileId] = {
            functions: ast.functions || [],
            classes: ast.classes || [],
            imports: ast.imports || [],
            exports: ast.exports || []
        };
    }

    // Build the complete message
    return `
## Original User Request
${userRequest}

## RAG Search Results
${JSON.stringify(ragSection, null, 2)}

## AST Data (File Structure)
${JSON.stringify(astSection, null, 2)}

## Dependency Graph
${JSON.stringify(dependencyGraph, null, 2)}

Based on this information, decide which files to fetch or whether to refine the search.`;
}

/**
 * Builds the message for final response generation with full code files.
 * This is sent to the LLM to generate the user's answer.
 */
function buildFinalContextMessage(userRequest, codeFiles, dependencyGraph) {
    // Format code files with their content and metadata
    const filesSection = codeFiles.map(function(file) {
        return `
### File: ${file.filePath}
**Language:** ${file.language}

**AST Summary:**
- Functions: ${(file.ast?.functions || []).map(f => f.name).join(', ') || 'none'}
- Classes: ${(file.ast?.classes || []).map(c => c.name).join(', ') || 'none'}

**Code:**
\`\`\`${file.language}
${file.content}
\`\`\`
`;
    }).join('\n---\n');

    // Build the complete message
    return `
## Original User Request
${userRequest}

## Relevant Code Files
${filesSection}

## Dependency Graph
${JSON.stringify(dependencyGraph, null, 2)}

Please analyze this codebase context and provide a comprehensive response to the user's request.`;
}
