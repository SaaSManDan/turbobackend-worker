import "dotenv/config";
import { Queue } from "bullmq";
import { redis } from "./databases/redisConnector.js";

async function testEnqueue() {
  const queue = new Queue("turbobackend-queue", { connection: redis });
  
  console.log("Adding test job to queue...");
  
  try {
    const job = await queue.add("mcpRequestJob", {
      mcp_key_id: "test_key_123",
      tool_name: "test_tool",
      request_params: { test: "data" },
      user_id: "test_user",
      project_id: "test_project",
      streamId: "test_stream"
    }, {
      attempts: 3
    });
    
    console.log(`Job added successfully! Job ID: ${job.id}`);
    console.log(`Job name: ${job.name}`);
    console.log(`Job data:`, job.data);
  } catch (error) {
    console.error("Error adding job:", error);
  }
  
  await queue.close();
  await redis.quit();
}

testEnqueue().catch(console.error);
