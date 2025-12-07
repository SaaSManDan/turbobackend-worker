import { streamText } from "ai";
import { createXai } from "@ai-sdk/xai";
import { publishLLMChunk, publishLLMDone, publishToChannel } from "../pubsub-handlers.js";
import { createDBSchemaTool } from "./tools/xAi/createDBSchema.js";

const xai = createXai({ apiKey: process.env.XAI_API_KEY });

const systemInstruction = `You are a development assistant that helps users build applications by creating database schemas, API endpoints, and other development artifacts.

IMPORTANT GUIDELINES:
1. When users ask you to CREATE, BUILD, DESIGN, MAKE, or ADD something (like database tables, schemas, tasks, nodes, etc.), use the appropriate tool IMMEDIATELY.
2. Infer reasonable defaults for missing details based on common development patterns. For example:
   - A "users" table should have: id, email, username, password_hash, created_at, updated_at
   - A "products" table should have: id, name, description, price, stock, created_at
   - A "tasks" table should have: id, title, description, status, priority, due_date, created_at
3. Only ask clarifying questions if critical business logic is ambiguous - do NOT ask for standard field definitions.
4. Execute tools proactively - don't describe what you would do, actually do it.

EXAMPLES:
- User: "Create a users table" → Use createDBSchema tool immediately with standard user fields
- User: "Build a products database schema" → Use createDBSchema tool with standard product fields
- User: "Design a schema for blog posts" → Use createDBSchema tool with: id, title, content, author_id, published_at, etc.

Remember: Your job is to BUILD, not just discuss. Use tools whenever possible.`;

/**
 * Trigger an LLM request and stream chunks to Redis so other backends can relay them.
 */
export async function callLLMStream(jobId, prompt, projectId) {
  console.log(`[callLLMStream] Starting for jobId: ${jobId}`);
  console.log(`[callLLMStream] Prompt: "${prompt}"`);
  console.log(`[callLLMStream] Project ID: "${projectId}"`);

  try {
    console.log(`[callLLMStream] Calling streamText with model: grok-4-fast`);
    const result = await streamText({
      model: xai("grok-4-fast"),
      prompt,
      temperature: 0.7,
      system: systemInstruction,
      tools: {
        createDBSchema: createDBSchemaTool(projectId),
      }
    });

    console.log(`[callLLMStream] streamText returned, starting to iterate chunks`);

    for await (const chunk of result.textStream) {
      const text =
        typeof chunk === "string"
          ? chunk
          : typeof chunk?.toString === "function"
            ? chunk.toString()
            : "";

      if (text) {
        await publishLLMChunk(jobId, text);
      }
    }

    await publishLLMDone(jobId);
    console.log(`[callLLMStream] ✅ Done signal published`);
  } catch (error) {
    console.error(`[callLLMStream] ❌ Error occurred:`, error.message);
    console.error(error);
    await publishToChannel(
      `llm-stream-${jobId}`,
      JSON.stringify({
        jobId,
        done: true,
        error: error instanceof Error ? error.message : "Unknown LLM error",
        timestamp: new Date().toISOString()
      })
    );
    throw error;
  }
}
