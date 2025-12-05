import { generateText } from "ai";
import { createXai } from "@ai-sdk/xai";
const xai = createXai({ apiKey: process.env.XAI_API_KEY });

/**
 * Call xAI non-streaming API and return response text with token usage.
 * @param {string} prompt - The prompt to send to the LLM (can be conversation history as JSON string)
 * @param {string} systemInstructions - System instructions for the LLM (optional if included in prompt)
 * @returns {Promise<Object>} - Object with text and usage
 */
export async function callLLMNonStream(prompt, systemInstructions = null) {
    try {
        const result = await generateText({
            model: xai('grok-4-fast'),
            system: systemInstructions,
            prompt,
        });

        console.log(`[xAI] Response received. Length: ${result.text.length}`);
        console.log(`[xAI] Usage - Input tokens: ${result.usage.inputTokens}, Output tokens: ${result.usage.outputTokens}`);

        return {
            text: result.text,
            usage: {
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens
            }
        };
    } catch (err) {
        console.error(`[xAI] Error:`, err);
        throw err;
    }
}
