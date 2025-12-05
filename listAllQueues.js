import "dotenv/config";
import { redis } from "./databases/redisConnector.js";

async function listAllQueues() {
  console.log("Scanning Redis for all BullMQ queues...\n");
  
  const keys = await redis.keys("bull:*");
  
  const queueNames = new Set();
  keys.forEach(key => {
    const parts = key.split(":");
    if (parts.length >= 2) {
      queueNames.add(parts[1]);
    }
  });
  
  console.log(`Found ${queueNames.size} queue(s):`);
  queueNames.forEach(name => console.log(`  - ${name}`));
  
  console.log("\n=== Checking for job 1600 in all queues ===");
  for (const queueName of queueNames) {
    const jobKey = `bull:${queueName}:1600`;
    const exists = await redis.exists(jobKey);
    if (exists) {
      console.log(`Found in queue: ${queueName}`);
      const jobData = await redis.hgetall(jobKey);
      console.log("Job data:", jobData);
    }
  }
  
  await redis.quit();
}

listAllQueues().catch(console.error);
