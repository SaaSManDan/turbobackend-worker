import "dotenv/config";
import { Queue } from "bullmq";
import { redis } from "./databases/redisConnector.js";

async function killAllJobs() {
  const queue = new Queue("turbobackend-queue", { connection: redis });
  
  console.log("=== Killing All Queue Jobs ===\n");
  
  // Get current counts
  const counts = await queue.getJobCounts();
  console.log("Current job counts:", counts);
  
  // Remove all waiting jobs
  console.log("\n🔴 Removing waiting jobs...");
  const waiting = await queue.getWaiting();
  for (const job of waiting) {
    try {
      await job.remove();
      console.log(`  ✓ Removed waiting job ${job.id}`);
    } catch (error) {
      if (error.message.includes("locked")) {
        console.log(`  ⚠️  Job ${job.id} is locked, moving to failed...`);
        await job.moveToFailed(new Error("Manually killed"), "0", true);
        console.log(`  ✓ Moved job ${job.id} to failed`);
      } else {
        throw error;
      }
    }
  }
  
  // Remove all active jobs (force if locked)
  console.log("\n🔴 Removing active jobs...");
  const active = await queue.getActive();
  for (const job of active) {
    try {
      await job.remove();
      console.log(`  ✓ Removed active job ${job.id}`);
    } catch (error) {
      if (error.message.includes("locked")) {
        console.log(`  ⚠️  Job ${job.id} is locked, moving to failed...`);
        await job.moveToFailed(new Error("Manually killed"), "0", true);
        console.log(`  ✓ Moved job ${job.id} to failed`);
      } else {
        throw error;
      }
    }
  }
  
  // Remove all delayed jobs
  console.log("\n🔴 Removing delayed jobs...");
  const delayed = await queue.getDelayed();
  for (const job of delayed) {
    await job.remove();
    console.log(`  ✓ Removed delayed job ${job.id}`);
  }
  
  // Clean failed and completed
  console.log("\n🧹 Cleaning failed jobs...");
  await queue.clean(0, 1000, "failed");
  
  console.log("🧹 Cleaning completed jobs...");
  await queue.clean(0, 1000, "completed");
  
  // Final counts
  const finalCounts = await queue.getJobCounts();
  console.log("\n✅ All jobs killed!");
  console.log("Final job counts:", finalCounts);
  
  await queue.close();
  await redis.quit();
}

killAllJobs().catch(console.error);
