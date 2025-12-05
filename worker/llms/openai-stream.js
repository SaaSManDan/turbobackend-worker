import OpenAI from "openai";
import { publishLLMChunk, publishLLMDone, publishToChannel } from "../pubsub-handlers.js";
import { nanoid } from 'nanoid';
import { createDBSchemaToolCall } from "./tools/gemini/createDBSchemaTool.js";
import { createAPIEndpointToolCall } from "./tools/gemini/createAPIEndpointTool.js";
import { createTaskToolCall } from "./tools/gemini/createTaskTool.js";
import { createTaskLinkToolCall, clearArtifactRegistry } from "./tools/gemini/createTaskLinkTool.js";
import { createPageFlowToolCall } from "./tools/gemini/createPageFlowTool.js";
import { generateCanvasFromArtifacts } from "../canvas/generateCanvasFromArtifacts.js";
import updateInitialProjectProgress from "../../utils/updateInitialProjectProgress.js";
import { trackMessageCost } from "../../utils/messageCostTracker.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Convert Gemini tool format to OpenAI tool format
function convertGeminiToolToOpenAI(geminiTool) {
  return {
    type: "function",
    function: {
      name: geminiTool.name,
      description: geminiTool.description,
      parameters: geminiTool.parameters
    }
  };
}

export async function callOpenAIStream(jobId, prompt, projectId, systemInstructions, isInitialProjectCreation, userId){
  console.log(`[callOpenAIStream] Starting for jobId: ${jobId}`);
  console.log(`[callOpenAIStream] Prompt: "${prompt}"`);
  console.log(`[callOpenAIStream] Project ID: "${projectId}"`);

  try {
    console.log(`[callOpenAIStream] Calling OpenAI with model: gpt-5-nano`);

    // Import tool format functions
    const { createDBSchemaToolFormat } = await import("./tools/gemini/createDBSchemaTool.js");
    const { createAPIEndpointToolFormat } = await import("./tools/gemini/createAPIEndpointTool.js");
    const { createTaskToolFormat } = await import("./tools/gemini/createTaskTool.js");
    const { createTaskLinkToolFormat } = await import("./tools/gemini/createTaskLinkTool.js");
    const { createPageFlowToolFormat } = await import("./tools/gemini/createPageFlowTool.js");

    // Convert tools from Gemini format to OpenAI format
    const tools = [
      convertGeminiToolToOpenAI(createDBSchemaToolFormat()),
      convertGeminiToolToOpenAI(createAPIEndpointToolFormat()),
      convertGeminiToolToOpenAI(createTaskToolFormat()),
      convertGeminiToolToOpenAI(createTaskLinkToolFormat()),
      convertGeminiToolToOpenAI(createPageFlowToolFormat())
    ];

    const stream = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [
        {
          role: "system",
          content: systemInstructions
        },
        {
          role: "user",
          content: prompt
        }
      ],
      tools: tools,
      tool_choice: "auto",
      stream: true,
      stream_options: { include_usage: true }
    });

    let fullText = '';
    let chunkCount = 0;
    let toolCalls = [];
    let currentToolCall = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      // Handle text chunks
      if (delta?.content) {
        chunkCount++;
        fullText += delta.content;
        console.log(`[callOpenAIStream] Text chunk #${chunkCount}: "${delta.content.substring(0, 50)}${delta.content.length > 50 ? '...' : ''}"`);
        await publishLLMChunk(jobId, delta.content);
      }

      // Handle tool calls
      if (delta?.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          if (toolCallDelta.index !== undefined) {
            // Start new tool call or continue existing one
            if (!toolCalls[toolCallDelta.index]) {
              toolCalls[toolCallDelta.index] = {
                id: toolCallDelta.id,
                type: toolCallDelta.type,
                function: {
                  name: toolCallDelta.function?.name || '',
                  arguments: toolCallDelta.function?.arguments || ''
                }
              };
            } else {
              // Append to existing tool call arguments
              if (toolCallDelta.function?.arguments) {
                toolCalls[toolCallDelta.index].function.arguments += toolCallDelta.function.arguments;
              }
            }
          }
        }
      }

      // Track usage metadata from final chunk
      if (chunk.usage) {
        try {
          await trackMessageCost({
            usageMetadata: {
              promptTokenCount: chunk.usage.prompt_tokens,
              candidatesTokenCount: chunk.usage.completion_tokens,
              totalTokenCount: chunk.usage.total_tokens
            },
            projectId,
            jobId,
            userId,
            promptContent: prompt.substring(0, 500),
            messageType: 'openai-stream',
            model: 'gpt-5-nano'
          });
        } catch (costTrackingError) {
          console.error(`[callOpenAIStream] ⚠️ Cost tracking failed:`, costTrackingError.message);
        }
      }
    }

    console.log(`[callOpenAIStream] All ${chunkCount} text chunks received. Full text length: ${fullText.length}`);

    if (toolCalls && toolCalls.length > 0) {
      console.log(`[callOpenAIStream] Processing ${toolCalls.length} function call(s)`);

      const toolRegistry = {
        createDBSchema: createDBSchemaToolCall,
        createAPIEndpoint: createAPIEndpointToolCall,
        createTask: createTaskToolCall,
        createTaskLink: createTaskLinkToolCall,
        createPageFlow: createPageFlowToolCall
      };

      for (let i = 0; i < toolCalls.length; i++) {
        const call = toolCalls[i];
        const functionName = call.function.name;
        const functionArgs = JSON.parse(call.function.arguments);

        console.log(`[callOpenAIStream] Function call: ${functionName}`);
        console.log(`[callOpenAIStream] Function args:`, JSON.stringify(functionArgs, null, 2));

        if(isInitialProjectCreation){
          if(toolCalls[i - 1] == null || functionName != toolCalls[i - 1].function.name){
            // this set of tool calling is starting
            await updateInitialProjectProgress("Starting " + functionName, jobId)
          }

          await toolRegistry[functionName](functionArgs, projectId, jobId);

          if(toolCalls[i + 1] == null || functionName != toolCalls[i + 1].function.name){
            // this set of tool calling is completed
            await updateInitialProjectProgress("Finishing " + functionName, jobId)
          }
        }
      }
    } else {
      console.log(`[callOpenAIStream] No function calls detected`);
    }

    // Generate canvas nodes and edges from created artifacts
    try {
      console.log(`[callOpenAIStream] Generating canvas from artifacts...`);
      const canvasResult = await generateCanvasFromArtifacts(projectId, jobId);
      console.log(`[callOpenAIStream] Canvas generation result:`, canvasResult);
    } catch (canvasError) {
      console.error(`[callOpenAIStream] ⚠️ Canvas generation failed, but continuing:`, canvasError.message);
      // Don't fail the entire job if canvas generation fails
    }

    // Clear artifact registry for this job
    clearArtifactRegistry(jobId);

    await publishLLMDone(jobId);
    console.log(`[callOpenAIStream] ✅ Done signal published`);
  } catch (error) {
    console.error(`[callOpenAIStream] ❌ Error occurred:`, error.message);
    console.error(error);

    // Clear artifact registry even on error
    clearArtifactRegistry(jobId);

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
};
