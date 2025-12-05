import "dotenv/config";
import { Queue } from "bullmq";
import { redis } from "./databases/redisConnector.js";

async function cleanQueue() {
  const queue = new Queue("turbobackend-queue", { connection: redis });
  
  console.log("Cleaning failed jobs...");
  await queue.clean(0, 1000, "failed");
  
  console.log("Cleaning completed jobs...");
  await queue.clean(0, 1000, "completed");
  
  console.log("Queue cleaned!");
  
  const counts = await queue.getJobCounts();
  console.log("New job counts:", counts);
  
  await queue.close();
  await redis.quit();
}

cleanQueue().catch(console.error);
