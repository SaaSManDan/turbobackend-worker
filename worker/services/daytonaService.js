import { nanoid } from "nanoid";
import pool from "../../databases/postgresConnector.js";
import { Daytona } from '@daytonaio/sdk';
import sandbox from "bullmq/dist/esm/classes/sandbox.js";

/**
 * Get or provision container for project
 */
export async function getOrProvisionContainer(projectId, client, databaseInfo = null, authInfo = null, paymentInfo = null) {
  // Always provision a new container
  console.log(`[Daytona] Provisioning new container for project: ${projectId}`);

  const containerId = await provisionDaytonaContainer(projectId);

  // Install tree command and AWS CLI
  console.log(`[Daytona] Installing tree command and AWS CLI...`);
  await executeCommandInContainer(containerId, 'apt update && apt install -y tree awscli');

  // New project - initialize Nitro.js
  console.log(`[Daytona] Initializing new Nitro.js project`);

  await initializeNitroProject(containerId, projectId, client, databaseInfo, authInfo, paymentInfo);

  console.log(`[Daytona] ✅ New Nitro.js project initialized`);

  // Record container session in database
  const sessionId = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await client.query(
    `INSERT INTO ${process.env.PG_DB_SCHEMA}.container_sessions
     (session_id, project_id, container_id, container_provider, status, environment, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sessionId, projectId, containerId, 'daytona', 'active', 'development', now]
  );

  console.log(`[Daytona] ✅ Container provisioned: ${containerId}`);

  return containerId;
}

export async function provisionDaytonaContainer() {
  // TODO: Implement actual Daytona API call [DONE]
  // For now, return a mock container ID
  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
  });

  let containerId;

  try {
    const sandbox = await daytona.create({
      public: false,
      image: "node:20",
    });

    containerId = sandbox.id; 
  } catch(error) {
    console.error("There was an error provisioning the daytona sandbox: " + error)
  }

  console.log(`[Daytona] Mock container provisioned: ${containerId}`);
  return containerId;
}

async function cloneGitHubRepo(containerId, repoInfo) {
  const { repo_url, branch, access_token_path } = repoInfo;
  
  // Get access token from parameter store
  const accessToken = await getParameterStoreValue(access_token_path);
  
  // Clone repo with authentication
  const repoUrlWithAuth = repo_url.replace('https://', `https://${accessToken}@`);
  
  await executeCommandInContainer(
    containerId,
    `git clone -b ${branch} ${repoUrlWithAuth} .`
  );
  
  // Configure git for future commits
  await executeCommandInContainer(containerId, 'git config user.name "TurboBackend Agent"');
  await executeCommandInContainer(containerId, 'git config user.email "drodriguez.dcr@gmail.com"');
}

async function initializeNitroProject(containerId, projectId, client, databaseInfo = null, authInfo = null, paymentInfo = null) {
  // Install Nitro.js and dependencies
  await executeCommandInContainer(containerId, 'npm init -y');

  // Install pnpm globally for faster package installation
  console.log('[Daytona] Installing pnpm...');
  await executeCommandInContainer(containerId, 'npm install -g pnpm', 30000);

  // Build list of all packages to install
  const packages = ['nitropack'];
  if (databaseInfo) packages.push('pg');
  if (authInfo && authInfo.needsAuth) packages.push('@clerk/clerk-sdk-node', 'svix');
  if (paymentInfo && paymentInfo.needsPayments) packages.push('stripe');

  // Install all packages with pnpm (faster than npm)
  console.log(`[Daytona] Installing packages: ${packages.join(', ')} (this may take a few minutes)...`);
  await executeCommandInContainer(containerId, `pnpm install ${packages.join(' ')}`, 300000);
  
  // Fix package.json scripts
  const packageJsonContent = await readFileFromContainer(containerId, 'package.json');
  const packageJson = JSON.parse(packageJsonContent);
  
  packageJson.scripts = {
    dev: 'nitro dev',
    build: 'nitro build',
    preview: 'nitro preview',
    test: 'echo "Error: no test specified" && exit 1'
  };
  
  await writeFileInContainer(containerId, 'package.json', JSON.stringify(packageJson, null, 2));

  // Create nitro.config.js
  const nitroConfig = `export default defineNitroConfig({
  srcDir: 'server'
});`;
  
  await writeFileInContainer(containerId, 'nitro.config.js', nitroConfig);
  
  // Create .env file with API keys and database credentials
  const sandbox = await getContainer(containerId);
  const projectDirPath = await sandbox.getUserHomeDir();
  
  let envContent = `GEMINI_API_KEY=${process.env.GEMINI_API_KEY}\nOPENAI_API_KEY=${process.env.OPENAI_API_KEY}\nXAI_API_KEY=${process.env.XAI_API_KEY}\nAWS_ACCESS_KEY_ID=${process.env.AWS_ACCESS_KEY_ID}\nAWS_SECRET_ACCESS_KEY=${process.env.AWS_SECRET_ACCESS_KEY}\nAWS_REGION=${process.env.AWS_REGION}`;
  
  if (databaseInfo) {
    console.log('[Daytona] Adding database credentials to .env...');
    envContent += `\nDB_HOST=${databaseInfo.host}\nDB_PORT=${databaseInfo.port}\nDB_NAME=${databaseInfo.dbName}\nDB_USER=${databaseInfo.user}\nDB_PASSWORD=${databaseInfo.password}`;
    
    // Create database connection file
    console.log('[Daytona] Creating database connection file...');
    const dbConnectionContent = `import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', function(err, client) {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export default pool;
`;
    await writeFileInContainer(containerId, 'server/utils/db.js', dbConnectionContent);
    console.log('[Daytona] ✅ Database connection file created');
  }

  // Add auth env vars if needed
  if (authInfo && authInfo.needsAuth) {
    console.log('[Daytona] Adding Clerk env var placeholders...');
    envContent += `\n\n# Clerk Authentication (REQUIRED - Add your keys)\nCLERK_SECRET_KEY=<YOUR_CLERK_SECRET_KEY>\nCLERK_PUBLISHABLE_KEY=<YOUR_CLERK_PUBLISHABLE_KEY>\nCLERK_WEBHOOK_SECRET=<YOUR_CLERK_WEBHOOK_SECRET>`;
  }

  // Add payment env vars if needed
  if (paymentInfo && paymentInfo.needsPayments) {
    console.log('[Daytona] Adding Stripe env var placeholders...');
    envContent += `\n\n# Stripe Payment Processing (REQUIRED - Add your keys)\nSTRIPE_SECRET_KEY=<YOUR_STRIPE_SECRET_KEY>\nSTRIPE_PUBLISHABLE_KEY=<YOUR_STRIPE_PUBLISHABLE_KEY>\nSTRIPE_WEBHOOK_SECRET=<YOUR_STRIPE_WEBHOOK_SECRET>`;
  }

  await sandbox.process.executeCommand(
    `echo "${envContent}" > .env`,
    projectDirPath
  );
  
  // Create deployment files (health check + fly.toml)
  await createDeploymentFiles(containerId, projectId);
  
  // Initialize git repository
  await executeCommandInContainer(containerId, 'git init');
  await executeCommandInContainer(containerId, 'git config user.name "TurboBackend Agent"');
  await executeCommandInContainer(containerId, 'git config user.email "agent@turbobackend.dev"');
  
  // Create .gitignore
  const gitignore = `node_modules/
.nitro/
.output/
dist/
.env
.DS_Store
.npm/
.pnpm-store/
.cache/
*.log
.vscode/
.idea/
.bashrc
.profile
.daytona/
.bash_history
.bash_logout
.fly/`;
  
  await writeFileInContainer(containerId, '.gitignore', gitignore);
  
  // Initial commit
  await executeCommandInContainer(containerId, 'git add .');
  await executeCommandInContainer(containerId, 'git commit -m "Initial Nitro.js project setup"');
}

/**
 * Create deployment files (health check endpoint only)
 * Note: fly.toml and Dockerfile are created later in flyioService.js during deployment
 */
async function createDeploymentFiles(containerId, projectId) {
  console.log(`[Daytona] Creating health check endpoint for ${projectId}`);

  // Create health check endpoint
  const healthEndpoint = `export default defineEventHandler(function() {
  return { status: 'ok', timestamp: Date.now() };
});`;

  await writeFileInContainer(containerId, 'server/api/health.get.js', healthEndpoint);

  console.log(`[Daytona] ✅ Health check endpoint created`);
}

/**
 * Ensure deployment files exist (for cloned projects)
 */
async function ensureDeploymentFiles(containerId, projectId) {
  console.log(`[Daytona] Ensuring deployment files exist for ${projectId}`);
  
  try {
    // Check if health endpoint exists
    const healthCheckResult = await executeCommandInContainer(
      containerId,
      'test -f server/api/health.get.js && echo "exists" || echo "missing"'
    );

    const healthCheckOutput = healthCheckResult.result || healthCheckResult.stdout || healthCheckResult;

    if (!healthCheckOutput.includes('exists')) {
      console.log(`[Daytona] Health endpoint missing, creating...`);
      const healthEndpoint = `export default defineEventHandler(function() {
  return { status: 'ok', timestamp: Date.now() };
});`;
      await writeFileInContainer(containerId, 'server/api/health.get.js', healthEndpoint);
    }

    // Check if fly.toml exists
    const flyTomlResult = await executeCommandInContainer(
      containerId,
      'test -f fly.toml && echo "exists" || echo "missing"'
    );

    const flyTomlOutput = flyTomlResult.result || flyTomlResult.stdout || flyTomlResult;

    if (!flyTomlOutput.includes('exists')) {
      console.log(`[Daytona] fly.toml missing, creating...`);
      const flyToml = `app = "turbobackend-${projectId}"

[build]
  builder = "heroku/buildpacks:20"

[env]
  PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    timeout = "5s"
    path = "/api/health"`;
      await writeFileInContainer(containerId, 'fly.toml', flyToml);
    }
    
    console.log(`[Daytona] ✅ Deployment files verified`);
  } catch (error) {
    console.error(`[Daytona] Error ensuring deployment files:`, error);
    // Non-fatal, continue execution
  }
}

/**
 * Execute command in container
 */
export async function executeCommandInContainer(containerId, command, timeout = 120000) {
  console.log(`[Daytona] Executing in ${containerId}: ${command}`);

  const sandbox = await getContainer(containerId);

  const rootDirPath = await sandbox.getUserHomeDir();

  // Add timeout wrapper
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Command timed out after ${timeout}ms`)), timeout);
  });

  const commandPromise = sandbox.process.executeCommand(
            command,
            rootDirPath
        );

  const gitCloneCmd = await Promise.race([commandPromise, timeoutPromise]);

  return gitCloneCmd;
}

async function getContainer(containerId){
  const daytona = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY,
  });

  const listSandboxes = await daytona.list();

  const sandbox = listSandboxes.items.find((s) => s.id === containerId);

  return sandbox;
}

/**
 * Write file in container
 */
export async function writeFileInContainer(containerId, path, content) {
  console.log(`[Daytona] Writing file in ${containerId}: ${path}`);

  const sandbox = await getContainer(containerId);
  const rootDirPath = await sandbox.getUserHomeDir();
  await sandbox.fs.uploadFile(Buffer.from(content), rootDirPath + "/" + path)
  
  
  return {
    success: true,
    path
  };
}

/**
 * Read file from container
 */
export async function readFileFromContainer(containerId, path) {
  const sandbox = await getContainer(containerId);
  const rootDirPath = await sandbox.getUserHomeDir();
  const fileBuffer = await sandbox.fs.downloadFile(rootDirPath + "/" + path);

  const content = fileBuffer.toString('utf-8');

  console.log(`[Daytona] Reading file from ${containerId}: ${path}`);
  
  return content;
}

/**
 * Delete file in container
 */
export async function deleteFileInContainer(containerId, path) {
  try {
    const sandbox = await getContainer(containerId);
    const rootDirPath = await sandbox.getUserHomeDir();
    await sandbox.fs.delete(rootDirPath + "/" + path)
    console.log(`[Daytona] Deleting file in ${containerId}: ${path}`);
    return { success: true };
  } catch(err){
    console.error("There was an error deleting a file inside Daytona sandbox: " + err)
  }
}

/**
 * Download file from container
 */
export async function downloadFileFromContainer(containerId, filePath) {
  console.log(`[Daytona] Downloading file from ${containerId}: ${filePath}`);
  
  const sandbox = await getContainer(containerId);

  const fileBuffer = await sandbox.fs.downloadFile(filePath);

  const content = fileBuffer.toString('utf-8');
  
  return content;
}

/**
 * Sync project directory to S3
 */
export async function syncProjectToS3(containerId, projectId) {
  console.log(`[S3] Syncing project ${projectId} to S3...`);
  
  const s3Path = `s3://${process.env.AWS_S3_BUCKET_NAME}/${projectId}/`;
  
  const syncCommand = `export AWS_ACCESS_KEY_ID="${process.env.AWS_ACCESS_KEY_ID}" && export AWS_SECRET_ACCESS_KEY="${process.env.AWS_SECRET_ACCESS_KEY}" && export AWS_DEFAULT_REGION="${process.env.AWS_REGION}" && aws s3 sync /root ${s3Path} --exclude "node_modules/*" --exclude ".git/*" --exclude ".github/*" --exclude ".fly/*" --exclude ".nitro/*" --exclude ".output/*" --exclude "dist/*" --exclude ".env" --exclude ".npm/*" --exclude ".pnpm-store/*" --exclude ".cache/*" --exclude ".daytona/*" --exclude ".local/*" --exclude ".DS_Store" --exclude ".bash_history" --exclude ".bash_logout" --exclude ".bashrc" --exclude ".profile" --exclude "fly.toml" --exclude ".gitignore" --exclude "pnpm-lock.yaml"`;
  
  console.log(`[S3] Executing sync command: ${syncCommand}`);
  
  const result = await executeCommandInContainer(containerId, syncCommand);
  
  console.log(`[S3] Sync command output:`, result);
  console.log(`[S3] ✅ Project synced to ${s3Path}`);
  
  return s3Path;
}

async function getParameterStoreValue(path) {
  // TODO: Implement AWS Parameter Store retrieval
  console.log(`[ParameterStore] Getting value for: ${path}`);
  return 'mock-token';
}


/**
 * Stop and remove a Daytona container
 */
export async function stopDaytonaContainer(containerId) {
    console.log(`[Daytona] Stopping container: ${containerId}`);

    try {
        const sandbox = await getContainer(containerId);

        await sandbox.stop();
        await sandbox.delete();
        
        console.log(`[Daytona] ✅ Container stopped and deleted successfully: ${containerId}`);
    } catch (error) {
        console.error(
            `[Daytona] Error stopping container ${containerId}:`,
            error,
        );
        throw error;
    }
}
