import { Queue } from 'bullmq';
import { nanoid } from 'nanoid';

const projectCreationQueue = new Queue('turbobackend-queue', {
  connection: {
    host: 'localhost',
    port: 6379
  }
});

async function addTestJob() {
  const streamId = nanoid();

  const jobData = {
    mcp_key_id: 'tb_live_fIZj-Y97nAhA6M-S5CSzbrRQ3-lds00C',
    tool_name: 'createBackendProject',
    request_params: {
      userPrompt: 'Build a blog API with user authentication and payment processing for premium subscriptions'
    },
    user_id: 'user_34Ix3ZIfBb1V9yGdFxwPAG4ufZe',
    project_id: `test-${nanoid(10)}`,
    streamId: streamId
  };

  console.log('Adding test job to queue...');
  console.log('Project ID:', jobData.project_id);
  console.log('User ID:', jobData.user_id);
  console.log('Stream ID:', streamId);
  console.log('Prompt:', jobData.request_params.userPrompt);
  console.log('');

  const job = await projectCreationQueue.add('initialProjectCreationJob', jobData, {
    attempts: 1,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  });

  console.log('✅ Job added successfully!');
  console.log('Job ID:', job.id);
  console.log('');
  console.log('Monitor with:');
  console.log(`redis-cli SUBSCRIBE stream:${streamId}`);
  console.log('');
  console.log('Or check logs in terminal running worker');

  process.exit(0);
}

addTestJob().catch(console.error);
