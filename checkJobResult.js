import { Queue } from 'bullmq';

const queue = new Queue('devdocsflow-queue', {
  connection: {
    host: 'localhost',
    port: 6379
  }
});

// Get the latest job (1591)
const job = await queue.getJob('1591');

if (!job) {
  console.log('❌ Job not found');
} else {
  console.log('Job ID:', job.id);
  console.log('Job Name:', job.name);
  console.log('Job State:', await job.getState());
  console.log('\n--- Job Data ---');
  console.log(JSON.stringify(job.data, null, 2));

  if (job.returnvalue) {
    console.log('\n--- Job Result ---');
    console.log(JSON.stringify(job.returnvalue, null, 2));
  }

  if (job.failedReason) {
    console.log('\n--- Failure Reason ---');
    console.log(job.failedReason);
  }

  if (job.stacktrace && job.stacktrace.length > 0) {
    console.log('\n--- Stack Trace ---');
    console.log(job.stacktrace[0]);
  }
}

await queue.close();
