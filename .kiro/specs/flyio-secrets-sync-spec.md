# Fly.io Secrets Sync Implementation Plan

## Problem
When users add cloud credentials to their project, those credentials need to be synced to their Fly.io deployment as encrypted secrets. Fly.io has no REST API for secrets - must use flyctl CLI.

## Solution
Execute flyctl commands in the Daytona container where the project code lives.

## Flow
1. User adds credentials in frontend console
2. Frontend sends credentials to backend API
3. Backend stores credentials in `cloud_credentials` table
4. Backend enqueues `sync-flyio-secrets` job to worker
5. Worker processor syncs credentials to Fly.io using flyctl
6. Fly.io automatically restarts app with new secrets

## Implementation Steps

### 1. Backend API Endpoint (Not in this repo)
- Receives credential from frontend
- Validates and stores in `cloud_credentials` table
- Enqueues job to worker queue:
  ```javascript
  await queue.add('sync-flyio-secrets', {
    projectId: 'proj123',
    credentialName: 'AWS_ACCESS_KEY_ID',
    credentialValue: 'AKIAIOSFODNN7EXAMPLE'
  });
  ```

### 2. Create Processor: `worker/processors/flyioSecretsSyncProcessor.js`
- Handle job type: `sync-flyio-secrets`
- Job data: `{ projectId, credentialName, credentialValue }`
- Call handler to add/update secret in Fly.io

### 3. Create Handler: `worker/handlers/flyioSecretsHandler.js`
Functions:
- `syncCredentialsToFlyio(projectId, credentialName, credentialValue)`
  - Get Fly.io app name from `project_deployments` table
  - Spin up new Daytona container
  - Install flyctl in container: `curl -L https://fly.io/install.sh | sh`
  - Get Fly.io API token from `.env` file
  - Execute: `export FLY_API_TOKEN=${process.env.FLY_API_TOKEN} && ~/.fly/bin/flyctl secrets set ${credentialName}=${credentialValue} --app ${appName}`
  - Tear down the container
  - Log to `project_actions` table upon success
  - Return success/failure


### 4. Register Processor in `worker/index.js`
- Import and register `flyioSecretsSyncProcessor`

### 5. Error Handling
- Container not found → Log error, fail job
- Fly.io app doesn't exist → Log warning, skip sync
- flyctl command fails → Log error, retry job
- Invalid credential format → Log error, fail job


## Security Notes
- Never log credential values, only keys
