import { callLLMNonStream } from "../llms/xai-non-stream.js";

/**
 * Detect if user's request requires a database
 */
export async function detectDatabaseNeed(userPrompt) {
  console.log(`[DatabaseDetector] Analyzing prompt for database need...`);
  
  const detectionPrompt = `Analyze this user request and determine if it requires a relational database (Postgres).

User Request: "${userPrompt}"

Consider if the application needs to:
- Store and retrieve data persistently
- Manage user accounts or authentication
- Handle complex data relationships
- Perform CRUD operations

Return JSON only in this exact format:
{
  "needsDatabase": true or false,
  "reasoning": "brief explanation"
}`;

  try {
    const result = await callLLMNonStream(detectionPrompt, null);
    const response = JSON.parse(result.text);
    
    console.log(`[DatabaseDetector] Needs database: ${response.needsDatabase}`);
    console.log(`[DatabaseDetector] Reasoning: ${response.reasoning}`);
    
    return {
      needsDatabase: response.needsDatabase,
      reasoning: response.reasoning,
      usage: result.usage
    };
  } catch (error) {
    console.error(`[DatabaseDetector] Error detecting database need:`, error);
    // Default to false if detection fails
    return {
      needsDatabase: false,
      reasoning: 'Detection failed, defaulting to no database',
      usage: { inputTokens: 0, outputTokens: 0 }
    };
  }
}
