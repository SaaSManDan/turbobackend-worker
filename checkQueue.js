import "dotenv/config";
import { Queue } from "bullmq";
import { redis } from "./databases/redisConnector.js";

async function checkQueue() {
  const queue = new Queue("turbobackend-queue", { connection: redis });
  
  console.log("=== Queue Status ===");
  const counts = await queue.getJobCounts();
  console.log("Job counts:", counts);
  
  console.log("\n=== Waiting Jobs ===");
  const waiting = await queue.getWaiting();
  console.log(`Found ${waiting.length} waiting jobs`);
  waiting.forEach(job => {
    console.log(`Job ${job.id}: name="${job.name}", data=`, job.data);
  });
  
  console.log("\n=== Active Jobs ===");
  const active = await queue.getActive();
  console.log(`Found ${active.length} active jobs`);
  active.forEach(job => {
    console.log(`Job ${job.id}: name="${job.name}", data=`, job.data);
  });
  
  console.log("\n=== Failed Jobs ===");
  const failed = await queue.getFailed();
  console.log(`Found ${failed.length} failed jobs`);
  failed.forEach(job => {
    console.log(`Job ${job.id}: name="${job.name}", failedReason="${job.failedReason}"`);
  });
  
  console.log("\n=== Completed Jobs ===");
  const completed = await queue.getCompleted();
  console.log(`Found ${completed.length} completed jobs`);
  
  await queue.close();
  await redis.quit();
}

checkQueue().catch(console.error);
