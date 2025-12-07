import "dotenv/config";
import { detectAuthenticationNeed } from "./worker/utils/authPaymentDetector.js";

async function test() {
  console.log('Testing auth detection with quick prompt...');
  console.log('XAI_API_KEY exists:', !!process.env.XAI_API_KEY);

  const result = await detectAuthenticationNeed("Build a blog API with user authentication");

  console.log('Result:', JSON.stringify(result, null, 2));
}

test().catch(console.error);
