import { redis } from "../databases/redisConnector.js";

// Duplicate the shared Redis client so publishing load does not block other Redis usage.
const publisher = redis.duplicate();

// Track when the publisher connection becomes ready so callers can await it before use.
const publisherReady = new Promise((resolve, reject) => {
  publisher.once("ready", resolve);
  publisher.once("error", reject);
});

publisher.on("error", (error) => {
  console.error("[pubsub] Publisher error", error);
});

/**
 * Ensure the publisher connection is ready before streaming any chunks.
 */
export const waitForPublisherReady = async () => publisherReady;

/**
 * Publish an arbitrary payload to a Redis channel dedicated to LLM streaming.
 */
export const publishToChannel = async (channel, payload) => {
  await waitForPublisherReady();
  await publisher.publish(channel, payload);
};

/**
 * Emit a partial LLM response chunk to the channel bound to the given job id.
 */
export const publishLLMChunk = async (jobId, chunk) => {
  const normalizedChunk =
    typeof chunk === "string"
      ? chunk
      : typeof chunk?.toString === "function"
        ? chunk.toString()
        : JSON.stringify(chunk);

  await publishToChannel(
    `llm-stream-${jobId}`,
    JSON.stringify({
      jobId,
      chunk: normalizedChunk,
      done: false,
      timestamp: new Date().toISOString()
    })
  );
};

/**
 * Emit the final message letting subscribers know no more LLM chunks are coming.
 */
export const publishLLMDone = async (jobId) => {
  await publishToChannel(
    `llm-stream-${jobId}`,
    JSON.stringify({
      jobId,
      done: true,
      timestamp: new Date().toISOString()
    })
  );
};

/**
 * Publish a progress update to the MCP tool execution stream.
 */
export const publishProgress = async (streamId, message, progress) => {
  await publishToChannel(
    streamId,
    JSON.stringify({
      message,
      progress
    })
  );
};

/**
 * Publish a final success result to the MCP tool execution stream.
 */
export const publishSuccess = async (streamId, content) => {
  await publishToChannel(
    streamId,
    JSON.stringify({
      complete: true,
      content,
      isError: false
    })
  );
};

/**
 * Publish a final error result to the MCP tool execution stream.
 */
export const publishError = async (streamId, content) => {
  await publishToChannel(
    streamId,
    JSON.stringify({
      complete: true,
      content,
      isError: true
    })
  );
};

/**
 * Close the publisher connection so the worker can shut down cleanly.
 */
export const closePubSub = async () => {
  publisher.removeAllListeners();
  await publisher.quit();
};
