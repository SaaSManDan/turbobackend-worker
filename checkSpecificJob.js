import "dotenv/config";
import { Queue } from "bullmq";
import { redis } from "./databases/redisConnector.js";

async function checkSpecificJob() {
  const queue = new Queue("turbobackend-queue", { connection: redis });
  
  console.log("Looking for job 1600...");
  
  try {
    const job = await queue.getJob("1600");
    
    if (job) {
      console.log("\n=== Job Found ===");
      console.log(`Job ID: ${job.id}`);
      console.log(`Job name: ${job.name}`);
      console.log(`Job state: ${await job.getState()}`);
      console.log(`Job data:`, job.data);
      console.log(`Job attempts: ${job.attemptsMade}/${job.opts.attempts}`);
      if (job.failedReason) {
        console.log(`Failed reason: ${job.failedReason}`);
      }
      console.log(`Job stacktrace:`, job.stacktrace);
    } else {
      console.log("Job 1600 not found");
    }
  } catch (error) {
    console.error("Error fetching job:", error);
  }
  
  console.log("\n=== All Queue Counts ===");
  const counts = await queue.getJobCounts();
  console.log(counts);
  
  await queue.close();
  await redis.quit();
}

checkSpecificJob().catch(console.error);
