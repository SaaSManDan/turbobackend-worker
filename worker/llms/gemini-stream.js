import { GoogleGenerativeAI } from "@google/generative-ai";
import { publishLLMChunk, publishLLMDone, publishToChannel } from "../pubsub-handlers.js";
import { nanoid } from 'nanoid';
import { createDBSchemaToolFormat, createDBSchemaToolCall } from "./tools/gemini/createDBSchemaTool.js";
import { createAPIEndpointToolFormat, createAPIEndpointToolCall } from "./tools/gemini/createAPIEndpointTool.js";
import { createTaskToolFormat, createTaskToolCall } from "./tools/gemini/createTaskTool.js";
import { createTaskLinkToolFormat, createTaskLinkToolCall, clearArtifactRegistry } from "./tools/gemini/createTaskLinkTool.js";
import { createPageFlowToolFormat, createPageFlowToolCall } from "./tools/gemini/createPageFlowTool.js";
import { generateCanvasFromArtifacts } from "../canvas/generateCanvasFromArtifacts.js";
import updateInitialProjectProgress from "../../utils/updateInitialProjectProgress.js";
import { trackMessageCost } from "../../utils/messageCostTracker.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function callGeminiStream(jobId, prompt, projectId, systemInstructions, isInitialProjectCreation, userId){
  console.log(`[callGeminiStream] Starting for jobId: ${jobId}`);
  console.log(`[callGeminiStream] Prompt: "${prompt}"`);
  console.log(`[callGeminiStream] Project ID: "${projectId}"`);

  try {
    console.log(`[callGeminiStream] Calling Gemini with model: gemini-2.5-flash`);

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      tools: [{
        functionDeclarations: [
          createDBSchemaToolFormat(),
          createAPIEndpointToolFormat(),
          createTaskToolFormat(),
          createTaskLinkToolFormat(),
          createPageFlowToolFormat()
        ]
      }],
      systemInstruction: systemInstructions,
      generationConfig: {
        temperature: 0.7
      }
    });

    const chat = model.startChat({
      history: []
    });

    console.log(`[callGeminiStream] Sending message stream...`);
    const result = await chat.sendMessageStream(prompt);

    let fullText = '';
    let chunkCount = 0;

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        chunkCount++;
        fullText += chunkText;
        console.log(`[callGeminiStream] Text chunk #${chunkCount}: "${chunkText.substring(0, 50)}${chunkText.length > 50 ? '...' : ''}"`);
        await publishLLMChunk(jobId, chunkText);
      }
    }

    console.log(`[callGeminiStream] All ${chunkCount} text chunks received. Full text length: ${fullText.length}`);

    // Get the final response to check for function calls
    const response = await result.response;
    const functionCalls = response.functionCalls();

    // Track message cost and token usage
    try {
      const usageMetadata = response.usageMetadata;
      if (usageMetadata) {
        await trackMessageCost({
          usageMetadata,
          projectId,
          jobId,
          userId, // userId not available in current function signature
          promptContent: prompt.substring(0, 500), // Store first 500 chars to avoid bloat
          messageType: 'gemini-stream',
          model: 'gemini-2.5-flash'
        });
      }
    } catch (costTrackingError) {
      console.error(`[callGeminiStream] ⚠️ Cost tracking failed:`, costTrackingError.message);
      // Don't fail the entire job if cost tracking fails
    }

    if (functionCalls && functionCalls.length > 0) {
      console.log(`[callGeminiStream] Processing ${functionCalls.length} function call(s)`);

      for (let i = 0; i < functionCalls.length; i++) {
        const call = functionCalls[i];
        console.log(`[callGeminiStream] Function call: ${call.name}`);
        console.log(`[callGeminiStream] Function args:`, JSON.stringify(call.args, null, 2));

        const toolRegistry = {
          createDBSchema: createDBSchemaToolCall,
          createAPIEndpoint: createAPIEndpointToolCall,
          createTask: createTaskToolCall,
          createTaskLink: createTaskLinkToolCall,
          createPageFlow: createPageFlowToolCall
        }

        if(isInitialProjectCreation){
          if(functionCalls[i - 1] == null || call.name != functionCalls[i - 1].name){
            // this set of tool calling is starting
            await updateInitialProjectProgress("Starting " + call.name, jobId)
          }

          await toolRegistry[call.name](call.args, projectId, jobId);

          if(functionCalls[i + 1] == null || call.name != functionCalls[i + 1].name){
            // this set of tool calling is completed
            await updateInitialProjectProgress("Finishing " + call.name, jobId)
          }
        }

      }
    } else {
      console.log(`[callGeminiStream] No function calls detected`);
    }

    // Generate canvas nodes and edges from created artifacts
    try {
      console.log(`[callGeminiStream] Generating canvas from artifacts...`);
      const canvasResult = await generateCanvasFromArtifacts(projectId, jobId);
      console.log(`[callGeminiStream] Canvas generation result:`, canvasResult);
    } catch (canvasError) {
      console.error(`[callGeminiStream] ⚠️ Canvas generation failed, but continuing:`, canvasError.message);
      // Don't fail the entire job if canvas generation fails
    }

    // Clear artifact registry for this job
    clearArtifactRegistry(jobId);

    await publishLLMDone(jobId);
    console.log(`[callGeminiStream] ✅ Done signal published`);
  } catch (error) {
    console.error(`[callGeminiStream] ❌ Error occurred:`, error.message);
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
