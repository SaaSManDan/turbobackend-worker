import "dotenv/config";
import { Queue, QueueEvents, Worker } from "bullmq";
import { redis } from "../databases/redisConnector.js";
import { getProcessor, listProcessors } from "./processors/processorFunctions.js";
import { closePubSub, waitForPublisherReady } from "./pubsub-handlers.js";

const queueName = "turbobackend-queue";

const concurrency = (() => {
  const raw = Number.parseInt(process.env.WORKER_CONCURRENCY ?? "5", 10);
  if (Number.isNaN(raw) || raw < 1) {
    throw new Error("WORKER_CONCURRENCY must be a positive integer");
  }
  return raw;
})();

const duplicatedConnections = [];

// Duplicate the shared Redis connection so BullMQ internals stay isolated per component.
const createConnection = () => {
  const connection = redis.duplicate();
  duplicatedConnections.push(connection);
  return connection;
};

// Spin up the worker and event listeners that keep the queue responsive.
async function startWorker() {
  await waitForPublisherReady();

  const worker = new Worker(
    queueName,
    async (job) => {
      // Route the incoming job by name to the registered processor module.
      const processor = getProcessor(job.name);
      if (!processor) {
        throw new Error(`No processor registered for job "${job.name}"`);
      }
      return processor(job);
    },
    {
      connection: createConnection(),
      concurrency,
      lockDuration: 600000, // 10 minutes - jobs can take a long time (Nitro install, AI generation, deployment)
      lockRenewTime: 30000   // Renew lock every 30 seconds
    }
  );
  await worker.waitUntilReady();

  const queueEvents = new QueueEvents(queueName, {
    connection: createConnection()
  });
  await queueEvents.waitUntilReady();

  queueEvents.on("completed", ({ jobId }) => {
    console.log(`[${queueName}] Job ${jobId} completed`);
  });

  queueEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(
      `[${queueName}] Job ${jobId} failed: ${failedReason}`
    );
  });

  worker.on("error", (error) => {
    console.error(`[${queueName}] Worker error`, error);
  });

  queueEvents.on("error", (error) => {
    console.error(`[${queueName}] Events error`, error);
  });

  // Gracefully tear down BullMQ components and Redis connections on exit signals.
  const shutdown = async () => {
    console.log("Shutting down worker...");

    // In development, clear all pending jobs from the queue
    if (process.env.NODE_ENV !== 'production') {
      console.log("[DEV] Clearing pending jobs from queue...");
      try {
        const queue = new Queue(queueName, { connection: createConnection() });
        await queue.obliterate({ force: true });
        console.log("[DEV] ✅ Queue cleared");
        await queue.close();
      } catch (error) {
        console.error("[DEV] Failed to clear queue:", error.message);
      }
    }

    await Promise.allSettled([
      worker.close(),
      queueEvents.close(),
      closePubSub()
    ]);
    await Promise.allSettled(
      duplicatedConnections.map((connection) => connection.quit())
    );
    await redis.quit();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(
    `Worker ready on queue "${queueName}" with concurrency ${concurrency}`
  );
  console.log(
    `Registered job processors: ${listProcessors().join(", ") || "none"}`
  );
}

// Boot the worker lifecycle; any failure bubbles to process exit.
startWorker().catch((error) => {
  console.error("Failed to start worker", error);
  process.exit(1);
});
