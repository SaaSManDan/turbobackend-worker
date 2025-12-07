import { callLLMNonStream } from "./xai-non-stream.js";
import { executeAgentCommands } from "../utils/agentCommandExecutor.js";
import { getContainerAgentSystemPrompt } from "./prompts/containerAgentSystem.js";
import { trackMessageCost, calculateCost } from "../../utils/messageCostTracker.js";

/**
 * Run the AI agent in a loop until it decides the task is complete
 */
export async function runAgenticLoop({
  containerId,
  projectId,
  userId,
  userRequest,
  requestId,
  databaseSchema = null,
  integrationSpecs = null,
  existingFiles = [],
  existingEndpoints = [],
  projectName = null,
  maxIterations = Infinity
}) {
  console.log(`[AgenticLoop] Starting for request: "${userRequest}"`);
  
  let iteration = 0;
  const conversationHistory = [];
  const filesModified = [];
  const dbQueries = [];
  
  // Track cumulative usage for cost tracking
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const startTime = Math.floor(Date.now() / 1000);
  
  // Determine process type
  const processType = existingEndpoints.length > 0 ? 'modification' : 'creation';
  
  // Get dynamic system prompt
  let systemPrompt = getContainerAgentSystemPrompt({ processType, projectName });
  
  if (databaseSchema) {
    console.log(`[AgenticLoop] Database available with ${databaseSchema.tables.length} tables`);
    systemPrompt += `\n\n=== DATABASE AVAILABLE ===\n\nYou have access to a Postgres database with the following schema:\n\n`;
    
    databaseSchema.tables.forEach(function(table) {
      systemPrompt += `Table: ${table.tableName}\n`;
      table.columns.forEach(function(col) {
        systemPrompt += `  - ${col.name} (${col.type}) ${col.constraints || ''}\n`;
      });
      systemPrompt += `\n`;
    });
    
    systemPrompt += `Database connection is already configured in .env:\n`;
    systemPrompt += `- DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD\n\n`;
    systemPrompt += `INSTRUCTIONS:\n`;
    systemPrompt += `- CRITICAL: Create a database connection utility file at server/utils/db.js with pg.Pool configuration that reads from .env variables\n`;
    systemPrompt += `- Import the database connection in any file that needs database access (e.g., import pool from '../utils/db.js' or import pool from '../../utils/db.js' depending on file location)\n`;
    systemPrompt += `- Write SQL queries in your endpoints using the exact table/column names above\n`;
    systemPrompt += `- Use parameterized queries ($1, $2, etc.) to prevent SQL injection\n`;
    systemPrompt += `- Handle database errors appropriately with try/catch\n`;
    systemPrompt += `- The pg package is already installed\n`;
  }
  
  // Add Clerk auth specs if available
  if (integrationSpecs?.clerk) {
    console.log(`[AgenticLoop] Clerk authentication enabled`);
    systemPrompt += `

=== CLERK AUTHENTICATION INTEGRATION REQUESTED ===

You have Clerk authentication configured for this project.

Environment Variables (in .env):
- CLERK_SECRET_KEY (REQUIRED - user must add)
- CLERK_PUBLISHABLE_KEY (REQUIRED - user must add)
- CLERK_WEBHOOK_SECRET (REQUIRED - user must add)

Clerk SDK Documentation:
${integrationSpecs.clerk}

IMPORTANT: The code examples below are REFERENCE examples only - they use import paths and dependencies from a different codebase structure. You MUST adapt them to work in this Nitro.js project by:
1. Creating any required utility files (e.g., database connection, error handling) in the correct locations for this project
2. Using correct relative import paths based on where files are located in the project structure
3. Only using dependencies that are available in this project (pg, @clerk/clerk-sdk-node, svix, stripe)
4. Do NOT copy import paths literally - adapt them to the actual file structure you are creating

INSTRUCTIONS:
- DO NOT install @clerk/clerk-sdk-node or svix - these packages are already installed
- If you need to install additional packages, use pnpm (NOT npm): pnpm install <package-name>
- Create authentication middleware using Clerk SDK
- Protect endpoints that require authentication
- Add user context to authenticated requests
- Handle authentication errors appropriately
- CRITICAL: Create a Clerk signup webhook endpoint (POST /api/webhooks/clerk.post.js) to sync users to database immediately upon signup. This is REQUIRED - see Example 4 in the documentation above.
- Add comments noting that CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, and CLERK_WEBHOOK_SECRET must be added to .env
`;
  }

  // Add Stripe payment specs if available
  if (integrationSpecs?.stripe) {
    console.log(`[AgenticLoop] Stripe payments enabled`);
    systemPrompt += `

=== STRIPE PAYMENT INTEGRATION REQUESTED ===

You have Stripe payment processing configured for this project.

Environment Variables (in .env):
- STRIPE_SECRET_KEY (REQUIRED - user must add)
- STRIPE_PUBLISHABLE_KEY (REQUIRED - user must add)
- STRIPE_WEBHOOK_SECRET (REQUIRED for webhooks)

Stripe SDK Documentation:
${integrationSpecs.stripe}

IMPORTANT: The code examples below are REFERENCE examples only - they use import paths and dependencies from a different codebase structure. You MUST adapt them to work in this Nitro.js project by:
1. Creating any required utility files in the correct locations for this project
2. Using correct relative import paths based on where files are located in the project structure
3. Only using dependencies that are available in this project (stripe, pg, @clerk/clerk-sdk-node, svix)
4. Do NOT copy import paths literally - adapt them to the actual file structure you are creating

INSTRUCTIONS:
- DO NOT install stripe - this package is already installed
- If you need to install additional packages, use pnpm (NOT npm): pnpm install <package-name>
- Initialize Stripe with secret key
- Implement payment intent endpoints
- Add webhook handler for payment events
- CRITICAL: Webhook handler should ONLY handle payment_intent.succeeded by default
- Only add other webhook event handlers (payment_failed, customer.created, etc.) if user explicitly requests them
- Add comments about required env vars
- Follow the exact patterns shown in the examples above
`;
  }

  // Add context about existing project if this is a modification
  if (existingEndpoints.length > 0) {
    console.log(`[AgenticLoop] Existing project with ${existingEndpoints.length} endpoints`);
    systemPrompt += `\n\n=== EXISTING ENDPOINTS ===\n\n`;
    systemPrompt += `This project already has the following endpoints:\n`;
    existingEndpoints.forEach(function(ep) {
      systemPrompt += `- ${ep.method} ${ep.path} (${ep.file})\n`;
    });
    systemPrompt += `\nWhen modifying, preserve existing functionality unless explicitly asked to change it.\n`;
    systemPrompt += `You can modify existing files or create new ones as needed.\n`;
  }

  // Initialize conversation
  conversationHistory.push({
    role: 'system',
    content: systemPrompt
  });
  
  conversationHistory.push({
    role: 'user',
    content: `User Request: "${userRequest}"`
  });
  
  while (iteration < maxIterations) {
    iteration++;
    console.log(`[AgenticLoop] Iteration ${iteration}/${maxIterations}`);
    
    // Call AI agent with full conversation history
    const result = await callLLMNonStream(
      JSON.stringify(conversationHistory),
      null
    );
    
    let agentResponse;
    try {
      agentResponse = JSON.parse(result.text);
    } catch (parseError) {
      console.error(`[AgenticLoop] JSON parse error:`, parseError.message);
      console.error(`[AgenticLoop] Raw response (first 500 chars):`, result.text.substring(0, 500));
      
      // Try to sanitize and parse again
      try {
        const sanitized = result.text
          .replace(/[\x00-\x1F\x7F]/g, function(char) {
            // Replace control characters with escaped versions
            const escapeMap = {
              '\n': '\\n',
              '\r': '\\r',
              '\t': '\\t',
              '\b': '\\b',
              '\f': '\\f'
            };
            return escapeMap[char] || '';
          });
        
        agentResponse = JSON.parse(sanitized);
        console.log(`[AgenticLoop] Successfully parsed after sanitization`);
      } catch (sanitizeError) {
        console.error(`[AgenticLoop] Sanitization failed, using fallback response`);
        
        // Fallback: create a minimal valid response
        agentResponse = {
          reasoning: "LLM returned invalid JSON format. Marking task as incomplete.",
          commands: [],
          taskComplete: false,
          summary: "Error: Invalid JSON response from LLM"
        };
        
        // Add error to conversation so agent can retry
        conversationHistory.push({
          role: 'user',
          content: `ERROR: Your previous response contained invalid JSON with control characters. Please respond with valid JSON only. Ensure all strings are properly escaped.`
        });
        
        continue;
      }
    }
    
    // Accumulate token usage
    totalInputTokens += result.usage.inputTokens;
    totalOutputTokens += result.usage.outputTokens;
    
    console.log(`[AgenticLoop] Agent reasoning: ${agentResponse.reasoning}`);
    console.log(`[AgenticLoop] Commands: ${agentResponse.commands?.length || 0}`);
    console.log(`[AgenticLoop] Task complete: ${agentResponse.taskComplete}`);
    
    conversationHistory.push({
      role: 'assistant',
      content: result.text
    });
    
    // Execute the commands the agent requested
    const executionResults = await executeAgentCommands(
      containerId,
      agentResponse.commands || []
    );
    
    // Track modifications
    for (const cmd of agentResponse.commands || []) {
      if (cmd.type === 'write') {
        filesModified.push({
          path: cmd.path,
          content: cmd.content,
          type: determineFileType(cmd.path)
        });
      }
      if (cmd.type === 'db_query') {
        dbQueries.push({
          query: cmd.query,
          schemaName: cmd.schemaName,
          type: cmd.queryType
        });
      }
    }
    
    // Add execution results to conversation
    conversationHistory.push({
      role: 'user',
      content: `Execution Results:\n${JSON.stringify(executionResults, null, 2)}\n\nContinue working or mark taskComplete: true if done.`
    });
    
    // Check if agent says it's done
    if (agentResponse.taskComplete === true) {
      console.log(`[AgenticLoop] ✅ Agent marked task as complete after ${iteration} iterations`);
      console.log(`[AgenticLoop] Summary: ${agentResponse.summary}`);
      break;
    }
  }
  
  // Calculate total cost and track ONCE at the end
  const endTime = Math.floor(Date.now() / 1000);
  const totalCost = calculateCost(totalInputTokens, totalOutputTokens, 'grok-4-fast');
  
  await trackMessageCost({
    usageMetadata: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens
    },
    projectId,
    jobId: requestId,
    userId,
    promptContent: userRequest,
    messageType: 'agentic-container-execution',
    model: 'grok-4-fast',
    timeToCompletion: endTime - startTime,
    startedAt: startTime
  });
  
  console.log(`[AgenticLoop] Total cost: $${totalCost.toFixed(6)} (${iteration} iterations)`);
  console.log(`[AgenticLoop] Total tokens - Input: ${totalInputTokens}, Output: ${totalOutputTokens}`);
  
  if (iteration >= maxIterations) {
    console.log(`[AgenticLoop] ⚠️ Max iterations (${maxIterations}) reached`);
  }
  
  // Extract API blueprint if provided
  const finalResponse = conversationHistory
    .filter(function(msg) { return msg.role === 'assistant'; })
    .map(function(msg) {
      try {
        return JSON.parse(msg.content);
      } catch (e) {
        return null;
      }
    })
    .filter(function(parsed) { return parsed && parsed.taskComplete === true; })
    .pop();
  
  const apiBlueprint = finalResponse?.apiBlueprint || null;
  
  return {
    success: iteration < maxIterations,
    iterations: iteration,
    filesModified,
    dbQueries,
    summary: iteration < maxIterations ? 'Task completed successfully' : 'Max iterations reached before task completion',
    conversationHistory,
    totalCost,
    apiBlueprint
  };
}

function determineFileType(filePath) {
  if (filePath.includes('/api/')) return 'route';
  if (filePath.includes('/middleware/')) return 'middleware';
  if (filePath.includes('/models/')) return 'model';
  if (filePath.includes('/utils/')) return 'utility';
  if (filePath.endsWith('.config.ts') || filePath.endsWith('.config.js')) return 'config';
  return 'other';
}
