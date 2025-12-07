import "dotenv/config";
import { initialProjectCreationProcessor } from "./worker/processors/initialProjectCreation.js";
import { redis } from "./databases/redisConnector.js";
import pool from "./databases/postgresConnector.js";

async function testInitialProjectCreationProcessor() {
  console.log("=== Testing MCP Request Processor ===\n");
  
  const mockJob = {
    id: "test-job-123",
    data: {
      mcp_key_id: "tb_live__dGmMOlmUuKL8i0ObON2K1mkWJwbs12K",
      tool_name: "spin_up_new_backend_project",
      request_params: {
        userPrompt: "I want you to create a simple receipt logging application (with no auth) that uses turbobackend to create the backend",
        projectName: "receipt-backend",
        includeAuth: false,
        includeDatabase: true,
        includeRedis: false,
        includeEmail: false,
        _apiKey: "tb_live__dGmMOlmUuKL8i0ObON2K1mkWJwbs12K"
      },
      user_id: "user_34Ix3ZIfBb1V9yGdFxwPAG4ufZe",
      project_id: "t9mpmjuljOinbwqkv5Zkq",
      streamId: "test-stream-123"
    }
  };
  
  console.log("Mock job data:", JSON.stringify(mockJob.data, null, 2));
  console.log("\nProcessing...\n");
  
  try {
    const result = await initialProjectCreationProcessor(mockJob);
    console.log("\n=== Success ===");
    console.log("Result:", result);
  } catch (error) {
    console.error("\n=== Error ===");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);
  } finally {
    await redis.quit();
    await pool.end();
  }
}

testInitialProjectCreationProcessor().catch(console.error);
