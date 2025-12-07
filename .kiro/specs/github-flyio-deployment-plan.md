# GitHub to Fly.io Deployment Plan

## Step 1: Modify Project Creation Handler
- After AI generates code and pushes to GitHub, inject GitHub Actions workflow file
- Create `.github/workflows/fly.yml` in the container
- Commit and push the workflow file to GitHub

**GitHub Actions Workflow File (`.github/workflows/fly.yml`):**
```yaml
name: Deploy to Fly.io
on:
  push:
    branches: [main]
jobs:
  deploy:
    name: Deploy app
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

## Step 2: Set GitHub Repository Secret
- Use GitHub API to set `FLY_API_TOKEN` as a repository secret
- Requires GitHub access token with `repo` scope
- API endpoint: `POST /repos/{owner}/{repo}/actions/secrets/FLY_API_TOKEN`

## Step 3: Create GitHub Actions Workflow File
- Workflow triggers on push to main branch
- Checks out code
- Sets up flyctl
- Runs `flyctl deploy --remote-only`
- Uses `FLY_API_TOKEN` from GitHub secrets

## Step 4: Comment Out Fly.io Deployment from Worker
- Comment out `deployProjectToFlyIO` call from `projectCreationExecutionHandler.js`
- Deployment now happens automatically via GitHub Actions
- Worker only needs to push code to GitHub

## Step 5: Update Progress Tracking
- Comment out "Deployment complete" progress message from worker
- Add "GitHub Actions deployment triggered" message instead
- Deployment status tracked separately via GitHub Actions

## Step 6: Add Deployment Status Webhook (Optional)
- Create webhook endpoint to receive GitHub Actions deployment status
- Update `project_deployments` table when deployment completes
- Notify user via pubsub when deployment succeeds/fails

## Step 7: Inject CORS Configuration
- After AI generates code, deterministically inject CORS files
- For Nitro.js: create `server/middleware/cors.ts`
- Commit CORS files before pushing to GitHub
- Ensures all projects have CORS configured

## Step 8: Update Fly.toml Generation
- Keep `fly.toml` and `Dockerfile` generation in worker
- These files are committed to GitHub
- GitHub Actions uses them for deployment

## Step 9: Handle Existing Projects
- For project modifications, workflow already exists in repo
- No need to recreate workflow file
- Deployment triggers automatically on push

## Step 10: Update Documentation
- Document new deployment flow
- Update environment variables needed
- Add troubleshooting guide for GitHub Actions failures
