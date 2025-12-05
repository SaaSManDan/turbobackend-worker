# Fly.io Deployment Guide - Programmatic Setup

## Overview
This guide covers how to programmatically deploy Nitro.js backend projects to Fly.io and get deployment URLs.

---

## Step 1: Sign Up for Fly.io

### Manual Setup (One-Time)
1. Go to https://fly.io/app/sign-up
2. Sign up with email or GitHub
3. Verify your email
4. Add payment method (required even for free tier)

### Get API Token
1. Go to https://fly.io/user/personal_access_tokens
2. Click "Create token"
3. Name it: "TurboBackend Deployment"
4. Copy the token (starts with `FlyV1_...`)
5. Store in AWS Parameter Store: `/turbobackend/flyio/api_token`

---

## Step 2: Install Fly CLI (Optional for Testing)

```bash
# macOS
brew install flyctl

# Linux
curl -L https://fly.io/install.sh | sh

# Authenticate
flyctl auth login
```

---

## Step 3: Programmatic Deployment Flow

### High-Level Process
```
1. Check if Fly.io app exists for project
2. If not, create new Fly.io app
3. Configure app (region, resources)
4. Deploy from GitHub repo
5. Get deployment URL
6. Store URL in database
```

### Detailed Steps

#### 3.1: Check if App Exists

**API Endpoint**: `GET https://api.machines.dev/v1/apps/{app_name}`

**Headers**:
```
Authorization: Bearer {FLY_API_TOKEN}
```

**Response**:
- 200: App exists
- 404: App doesn't exist

**Code**:
```javascript
async function checkFlyAppExists(projectId) {
    const appName = `turbobackend-${projectId}`;
    const flyApiToken = await getParameterStoreValue('/turbobackend/flyio/api_token');
    
    try {
        const response = await fetch(`https://api.machines.dev/v1/apps/${appName}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${flyApiToken}`
            }
        });
        
        return response.status === 200;
    } catch (error) {
        return false;
    }
}
```

---

#### 3.2: Create Fly.io App

**API Endpoint**: `POST https://api.machines.dev/v1/apps`

**Headers**:
```
Authorization: Bearer {FLY_API_TOKEN}
Content-Type: application/json
```

**Body**:
```json
{
  "app_name": "turbobackend-proj123",
  "org_slug": "personal"
}
```

**Response**:
```json
{
  "id": "app_id",
  "name": "turbobackend-proj123",
  "status": "pending",
  "organization": {...}
}
```

**Code**:
```javascript
async function createFlyApp(projectId) {
    const appName = `turbobackend-${projectId}`;
    const flyApiToken = await getParameterStoreValue('/turbobackend/flyio/api_token');
    
    const response = await fetch('https://api.machines.dev/v1/apps', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${flyApiToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            app_name: appName,
            org_slug: 'personal'
        })
    });
    
    if (!response.ok) {
        throw new Error(`Failed to create Fly app: ${response.statusText}`);
    }
    
    return await response.json();
}
```

---

#### 3.3: Create fly.toml Configuration

**File**: `fly.toml` (in GitHub repo)

**IMPORTANT: Cost optimization settings included**

```toml
app = "turbobackend-proj123"
primary_region = "iad"

[build]
  [build.args]
    NODE_VERSION = "20"

[env]
  PORT = "3000"
  NODE_ENV = "production"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true      # COST OPTIMIZATION: Stop when idle
  auto_start_machines = true     # COST OPTIMIZATION: Start on request
  min_machines_running = 0       # COST OPTIMIZATION: No always-on machines
  processes = ["app"]

[[vm]]
  cpu_kind = "shared"            # COST OPTIMIZATION: Cheapest CPU type
  cpus = 1
  memory_mb = 256                # COST OPTIMIZATION: Minimum memory

# COST OPTIMIZATION: Stop after 5 minutes of inactivity
[http_service.concurrency]
  type = "requests"
  soft_limit = 200
  hard_limit = 250

# COST OPTIMIZATION: Auto-stop configuration
[[services]]
  protocol = "tcp"
  internal_port = 3000

  [[services.ports]]
    port = 80
    handlers = ["http"]
    force_https = true

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [services.concurrency]
    type = "requests"
    hard_limit = 250
    soft_limit = 200

# COST OPTIMIZATION: Stop machines after 5 minutes idle
[experimental]
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0
```

**Code**:
```javascript
async function createFlyToml(containerId, projectId) {
    const appName = `turbobackend-${projectId}`;
    
    const flyTomlContent = `app = "${appName}"
primary_region = "iad"

[build]
  [build.args]
    NODE_VERSION = "20"

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
    
    await writeFileInContainer(containerId, 'fly.toml', flyTomlContent);
    
    // Commit to git
    await executeCommandInContainer(containerId, 'git add fly.toml');
    await executeCommandInContainer(containerId, 'git commit -m "Add Fly.io configuration with cost optimizations"');
    await executeCommandInContainer(containerId, 'git push origin main');
    
    console.log('[Fly.io] fly.toml created with cost optimizations enabled');
}
```

---

#### 3.4: Deploy to Fly.io

**Option A: Using Fly CLI (Recommended)**

```bash
# In container
flyctl deploy --remote-only --app turbobackend-proj123
```

**Option B: Using Fly API + GitHub Actions**

Create `.github/workflows/fly-deploy.yml`:
```yaml
name: Deploy to Fly.io
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

**Option C: Using Fly API Directly (Most Control)**

**API Endpoint**: `POST https://api.machines.dev/v1/apps/{app_name}/machines`

This creates a machine (VM) that runs your app.

**Code for Deployment**:
```javascript
async function deployToFlyIO(projectId, githubRepoUrl) {
    const appName = `turbobackend-${projectId}`;
    
    // Ensure app exists
    const appExists = await checkFlyAppExists(projectId);
    if (!appExists) {
        await createFlyApp(projectId);
    }
    
    // Deploy using flyctl command
    const deployCommand = `flyctl deploy --remote-only --app ${appName}`;
    const result = await executeCommandWithFlyToken(deployCommand);
    
    if (result.success) {
        const appUrl = `https://${appName}.fly.dev`;
        
        // Store in database
        const deploymentId = nanoid();
        const now = Math.floor(Date.now() / 1000);
        
        await client.query(
            `INSERT INTO ${process.env.PG_DB_SCHEMA}.project_deployments 
             (deployment_id, project_id, platform, app_name, url, status, deployed_at, last_updated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [deploymentId, projectId, 'flyio', appName, appUrl, 'deployed', now, now]
        );
        
        return { success: true, url: appUrl };
    } else {
        throw new Error(`Deployment failed: ${result.error}`);
    }
}
```

---

#### 3.5: Get Deployment URL

**URL Format**: `https://{app_name}.fly.dev`

Example: `https://turbobackend-proj123.fly.dev`

**Verify Deployment**:
```javascript
async function verifyDeployment(appUrl) {
    try {
        const response = await fetch(`${appUrl}/api/health`, {
            method: 'GET',
            timeout: 10000
        });
        
        return response.status === 200;
    } catch (error) {
        console.error('[Fly.io] Deployment verification failed:', error);
        return false;
    }
}
```

---

## Step 4: Complete Deployment Flow

**File**: `worker/services/flyioService.js`

**Code**:
```javascript
import { nanoid } from 'nanoid';
import { executeCommandInContainer, writeFileInContainer } from './daytonaService.js';
import { getParameterStoreValue } from '../utils/parameterStore.js';

async function deployProjectToFlyIO(projectId, githubRepoUrl, containerId, client) {
    const appName = `turbobackend-${projectId}`;
    
    console.log(`[Fly.io] Starting deployment for project ${projectId}`);
    
    // 1. Create fly.toml in container with cost optimizations
    await createFlyToml(containerId, projectId);
    
    // 2. Check if Fly app exists
    const appExists = await checkFlyAppExists(projectId);
    
    if (!appExists) {
        // 3. Create Fly app
        console.log(`[Fly.io] Creating new app: ${appName}`);
        await createFlyApp(projectId);
    }
    
    // 4. Install flyctl in container if not present
    console.log('[Fly.io] Installing flyctl...');
    await executeCommandInContainer(containerId, 'curl -L https://fly.io/install.sh | sh');
    
    // 5. Set API token environment variable
    const flyApiToken = await getParameterStoreValue('/turbobackend/flyio/api_token');
    
    // 6. Deploy using flyctl
    console.log(`[Fly.io] Deploying app: ${appName}`);
    const deployCommand = `export FLY_API_TOKEN="${flyApiToken}" && ~/.fly/bin/flyctl deploy --remote-only --app ${appName}`;
    
    try {
        const deployResult = await executeCommandInContainer(containerId, deployCommand);
        
        if (deployResult.exitCode === 0) {
            const appUrl = `https://${appName}.fly.dev`;
            
            console.log(`[Fly.io] Deployment successful: ${appUrl}`);
            
            // 7. Verify deployment
            const isHealthy = await verifyDeployment(appUrl);
            
            if (isHealthy) {
                // 8. Store in database
                const deploymentId = nanoid();
                const now = Math.floor(Date.now() / 1000);
                
                await client.query(
                    `INSERT INTO ${process.env.PG_DB_SCHEMA}.project_deployments 
                     (deployment_id, project_id, platform, app_name, url, status, deployed_at, last_updated)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [deploymentId, projectId, 'flyio', appName, appUrl, 'deployed', now, now]
                );
                
                console.log(`[Fly.io] ✅ Deployment complete and verified`);
                
                return { success: true, url: appUrl, appName };
            } else {
                console.error('[Fly.io] Deployment verification failed');
                return { success: false, error: 'Deployment verification failed' };
            }
        } else {
            console.error('[Fly.io] Deployment failed:', deployResult.stderr);
            return { success: false, error: deployResult.stderr };
        }
    } catch (error) {
        console.error('[Fly.io] Deployment error:', error);
        return { success: false, error: error.message };
    }
}

export { deployProjectToFlyIO, checkFlyAppExists, createFlyApp, createFlyToml, verifyDeployment };
```

---

## Step 5: Database Schema

### Project Deployments Table
```sql
CREATE TABLE turbobackend.project_deployments (
  deployment_id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES turbobackend.projects(project_id),
  platform VARCHAR NOT NULL, -- 'flyio', 'vercel', 'railway', etc.
  app_name VARCHAR NOT NULL,
  url VARCHAR NOT NULL,
  status VARCHAR NOT NULL, -- 'deploying', 'deployed', 'failed', 'stopped'
  deployed_at BIGINT NOT NULL,
  last_updated BIGINT NOT NULL
);

```

---

## Step 6: Integration with Main Flow

Update `worker/handlers/agenticExecutionHandler.js`:

**Code**:
```javascript
async function handleAgenticExecution(job, requestId) {
    // ... existing code ...
    
    // Phase 3: Post-Execution (DETERMINISTIC)
    let githubPushResult = null;
    let s3UploadResult = null;
    let deploymentResult = null;
    
    if (agentResult.filesModified?.length > 0) {
        // Push to GitHub
        githubPushResult = await pushToGitHubDeterministic(
            containerId, 
            project_id, 
            agentResult.filesModified,
            client
        );
        
        // Upload to S3
        s3UploadResult = await uploadFilesToS3(
            containerId, 
            project_id, 
            user_id, 
            agentResult.filesModified
        );
        
        // NEW: Deploy to Fly.io
        const githubRepoUrl = githubPushResult.repoUrl;
        deploymentResult = await deployProjectToFlyIO(
            project_id, 
            githubRepoUrl, 
            containerId,
            client
        );
    }
    
    // ... rest of code ...
    
    return {
        success: true,
        requestId,
        containerId,
        iterations: agentResult.iterations,
        filesModified: agentResult.filesModified,
        dbQueries: agentResult.dbQueries,
        agentSummary: agentResult.summary,
        githubPushResult,
        s3UploadResult,
        dbExecutionResult,
        deploymentResult  // NEW: Include deployment info
    };
}
```

---

## Step 7: Environment Variables

Store in AWS Parameter Store:
- `/turbobackend/flyio/api_token` - Fly.io API token
- `/turbobackend/flyio/org_slug` - Organization slug (usually "personal")

---

## Step 8: Cost Considerations

### Fly.io Free Tier
- 3 shared-cpu-1x VMs with 256MB RAM
- 160GB outbound data transfer
- Auto-stop/start machines (pay only when running)

### Pricing After Free Tier
- Shared CPU: ~$0.0000008/second (~$2/month if always on)
- 256MB RAM: Included
- Bandwidth: $0.02/GB after 160GB

### Cost Optimization
- Use `auto_stop_machines = true` - stops when idle
- Use `min_machines_running = 0` - no always-on cost
- Machines start automatically on request (cold start ~1-2s)

---

## Step 9: Testing

### Manual Test
```bash
# Create test app
flyctl apps create turbobackend-test

# Deploy
flyctl deploy --app turbobackend-test

# Check status
flyctl status --app turbobackend-test

# Get URL
echo "https://turbobackend-test.fly.dev"

# Delete app
flyctl apps destroy turbobackend-test
```

### Programmatic Test
```javascript
// Test deployment flow
const result = await deployProjectToFlyIO('test123', 'https://github.com/user/repo', containerId);
console.log(result.url); // https://turbobackend-test123.fly.dev
```

---

## Step 10: Monitoring & Logs

### Get Logs via API
```
GET https://api.machines.dev/v1/apps/{app_name}/machines/{machine_id}/logs
```

### Get App Status
```
GET https://api.machines.dev/v1/apps/{app_name}
```

### Health Checks
Add to Nitro.js project:
```typescript
// server/api/health.get.ts
export default defineEventHandler(() => {
  return { status: 'ok', timestamp: Date.now() };
});
```

---

## Summary

**Complete Flow**:
1. User requests backend creation via MCP
2. Agent creates code in container
3. Code pushed to GitHub
4. `fly.toml` created and committed
5. Fly.io app created (if doesn't exist)
6. Project deployed to Fly.io using `flyctl deploy`
7. Deployment URL returned: `https://turbobackend-{projectId}.fly.dev`
8. URL stored in database
9. User receives deployment URL

**Key Files**:
- `worker/services/flyioService.js` - Fly.io deployment logic
- `fly.toml` - Fly.io configuration (in each project repo)
- Database table: `project_deployments`

**API Token**: Store in Parameter Store and inject into container for `flyctl` commands.
