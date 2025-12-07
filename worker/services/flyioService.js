import { nanoid } from 'nanoid';
import { executeCommandInContainer, writeFileInContainer } from './daytonaService.js';
import { trackActivity } from '../utils/activityTracker.js';

/**
 * Deploy project to Fly.io
 */
export async function deployProjectToFlyIO(projectId, githubRepoUrl, containerId, client, databaseInfo = null, userId = null, requestId = null) {
  const appName = `turbobackend-${projectId}`.toLowerCase();

  console.log(`[Fly.io] Starting deployment for project ${projectId}`);
  
  // 1. Create fly.toml in container with cost optimizations
  await createFlyToml(containerId, projectId);
  
  // 2. Install flyctl in container if not present
  console.log('[Fly.io] Installing flyctl...');
  await executeCommandInContainer(containerId, 'curl -L https://fly.io/install.sh | sh');
  
  // 3. Check if Fly app exists
  const appExists = await checkFlyAppExists(containerId, projectId);
  
  if (!appExists) {
    // 4. Create Fly app
    console.log(`[Fly.io] Creating new app: ${appName}`);
    await createFlyApp(containerId, projectId);
  }
  
  // 4.5. Set database secrets if database exists
  if (databaseInfo) {
    console.log(`[Fly.io] Setting database secrets for app: ${appName}`);
    await setDatabaseSecrets(containerId, appName, databaseInfo);
  }
  
  // 5. Deploy using flyctl
  console.log(`[Fly.io] Deploying app: ${appName}`);
  const deployCommand = `export FLY_API_TOKEN="${process.env.FLY_API_TOKEN}" && ~/.fly/bin/flyctl deploy --remote-only --app ${appName}`;
  
  try {
    const deployResult = await executeCommandInContainer(containerId, deployCommand);
    
    // Handle the result - extract output from the result object
    let resultStr = '';
    if (typeof deployResult === 'string') {
      resultStr = deployResult;
    } else if (deployResult && typeof deployResult === 'object') {
      resultStr = JSON.stringify(deployResult);
    }
    
    console.log(`[Fly.io] Deploy result:`, resultStr);

    // Check for success indicators in the output (case-insensitive)
    const resultStrLower = resultStr.toLowerCase();
    if (resultStrLower.includes('successfully deployed') || resultStrLower.includes('deployed successfully') || resultStrLower.includes('visit your newly deployed app')) {
      const appUrl = `https://${appName}.fly.dev`;
      
      console.log(`[Fly.io] Deployment successful: ${appUrl}`);
      
      // 6. Verify deployment
      const isHealthy = await verifyDeployment(appUrl);
      
      if (isHealthy) {
        // 7. Store in database
        const deploymentId = nanoid();
        const now = Math.floor(Date.now() / 1000);
        
        await client.query(
          `INSERT INTO ${process.env.PG_DB_SCHEMA}.project_deployments 
           (deployment_id, project_id, platform, app_name, url, status, deployed_at, last_updated)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [deploymentId, projectId, 'flyio', appName, appUrl, 'deployed', now, now]
        );
        
        console.log(`[Fly.io] ✅ Deployment complete and verified`);
        
        // Track deployment activity
        if (userId) {
          try {
            await trackActivity({
              projectId,
              userId,
              requestId,
              actionType: 'deployment',
              actionDetails: `Deployed to fly.io: ${appUrl}`,
              status: 'success',
              environment: 'production',
              referenceIds: {
                deployment_id: deploymentId,
                app_name: appName
              },
              client
            });
          } catch (error) {
            console.error(`[ActivityTracker] Failed to track deployment: ${error.message}`);
          }
        }
        
        return { success: true, deploymentUrl: appUrl, appName };
      } else {
        console.error('[Fly.io] Deployment verification failed');
        return { success: false, error: 'Deployment verification failed' };
      }
    } else {
      console.error('[Fly.io] Deployment failed:', resultStr);
      return { success: false, error: resultStr };
    }
  } catch (error) {
    console.error('[Fly.io] Deployment error:', error);
    return { success: false, error: error.message };
  }
}

async function checkFlyAppExists(containerId, projectId) {
  const appName = `turbobackend-${projectId}`.toLowerCase();
  
  try {
    const command = `export FLY_API_TOKEN="${process.env.FLY_API_TOKEN}" && ~/.fly/bin/flyctl apps list --json`;
    const result = await executeCommandInContainer(containerId, command);
    
    console.log('[Fly.io] Apps list result type:', typeof result);
    console.log('[Fly.io] Apps list result:', result);
    
    // Handle the result - could be string or object
    let resultStr = '';
    if (typeof result === 'string') {
      resultStr = result;
    } else if (result && typeof result === 'object') {
      // If it's already an object, check if it has the data we need
      if (Array.isArray(result)) {
        return result.some(function(app) { return app.Name === appName; });
      }
      // Extract the actual JSON from the result object
      resultStr = result.result || result.artifacts?.stdout || '';
    }
    
    if (resultStr) {
      try {
        const apps = JSON.parse(resultStr);
        const exists = apps.some(function(app) { return app.Name === appName; });
        console.log(`[Fly.io] App ${appName} exists: ${exists}`);
        return exists;
      } catch (parseError) {
        console.error('[Fly.io] Failed to parse apps list:', parseError.message);
        return false;
      }
    }
    
    return false;
  } catch (error) {
    console.error('[Fly.io] Error checking if app exists:', error);
    return false;
  }
}

async function createFlyApp(containerId, projectId) {
  const appName = `turbobackend-${projectId}`.toLowerCase();
  
  try {
    const command = `export FLY_API_TOKEN="${process.env.FLY_API_TOKEN}" && ~/.fly/bin/flyctl apps create ${appName} --org personal`;
    const result = await executeCommandInContainer(containerId, command);
    
    console.log('[Fly.io] Create app result type:', typeof result);
    console.log('[Fly.io] Create app result:', result);
    
    // Handle the result - extract output from the result
    let resultStr = '';
    if (typeof result === 'string') {
      resultStr = result;
    } else if (result && typeof result === 'object') {
      resultStr = JSON.stringify(result);
    }
    
    // Check if app was created successfully or already exists
    if (resultStr.includes('created') || resultStr.includes('New app created')) {
      console.log(`[Fly.io] App created successfully: ${appName}`);
      return { success: true, appName };
    } else if (resultStr.includes('already exists') || resultStr.includes('taken')) {
      console.log(`[Fly.io] App already exists: ${appName}`);
      return { success: true, appName, alreadyExists: true };
    } else {
      console.log(`[Fly.io] App creation result: ${resultStr}`);
      // Assume success if no error
      return { success: true, appName };
    }
  } catch (error) {
    console.error('[Fly.io] Error creating app:', error);
    // Check if error message indicates app already exists
    const errorMsg = error.message || error.toString();
    if (errorMsg.includes('already exists') || errorMsg.includes('taken')) {
      console.log(`[Fly.io] App already exists (from error): ${appName}`);
      return { success: true, appName, alreadyExists: true };
    }
    throw error;
  }
}

async function createFlyToml(containerId, projectId) {
  const appName = `turbobackend-${projectId}`.toLowerCase();

  const flyTomlContent = `app = "${appName}"
primary_region = "iad"

[build]

[env]
  PORT = "3000"
  NODE_ENV = "production"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0
  processes = ["app"]

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256

[http_service.concurrency]
  type = "requests"
  soft_limit = 200
  hard_limit = 250

[experimental]
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0
`;

  // Create Dockerfile for Nitro.js
  const dockerfileContent = `FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY . .
RUN pnpm run build

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
`;

  await writeFileInContainer(containerId, 'fly.toml', flyTomlContent);
  await writeFileInContainer(containerId, 'Dockerfile', dockerfileContent);

  console.log('[Fly.io] fly.toml and Dockerfile created (git commit handled by main handler)');
}

async function verifyDeployment(appUrl) {
  try {
    const response = await fetch(`${appUrl}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000)
    });
    
    return response.status === 200;
  } catch (error) {
    console.error('[Fly.io] Deployment verification failed:', error);
    return false;
  }
}

async function getParameterStoreValue(path) {
  // TODO: Implement AWS Parameter Store retrieval
  console.log(`[ParameterStore] Getting value for: ${path}`);
  return 'mock-fly-token';
}

export { checkFlyAppExists, createFlyApp, createFlyToml, verifyDeployment };

/**
 * Set database secrets in Fly.io app
 */
async function setDatabaseSecrets(containerId, appName, databaseInfo) {
  try {
    const secretsCommand = `export FLY_API_TOKEN="${process.env.FLY_API_TOKEN}" && ~/.fly/bin/flyctl secrets set DB_HOST="${databaseInfo.host}" DB_PORT="${databaseInfo.port}" DB_NAME="${databaseInfo.dbName}" DB_USER="${databaseInfo.user}" DB_PASSWORD="${databaseInfo.password}" --app ${appName}`;
    
    const result = await executeCommandInContainer(containerId, secretsCommand);
    
    console.log(`[Fly.io] Database secrets set for app: ${appName}`);
    return { success: true };
  } catch (error) {
    console.error(`[Fly.io] Error setting database secrets:`, error);
    throw error;
  }
}
