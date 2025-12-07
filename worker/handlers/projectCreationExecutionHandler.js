import pool from "../../databases/postgresConnector.js";
import { getOrProvisionContainer, syncProjectToS3, writeFileInContainer, executeCommandInContainer } from "../services/daytonaService.js";
import { runAgenticLoop } from "../llms/agenticLoopExecutor.js";
import { pushToGitHubDeterministic } from "../utils/githubIntegration.js";
import { deployProjectToFlyIO, createFlyToml, createFlyApp } from "../services/flyioService.js";
import { injectCorsMiddleware } from "../utils/corsInjector.js";
import { injectGitHubActionsWorkflow, setGitHubSecret } from "../utils/githubActionsInjector.js";
import { publishProgress, publishSuccess, publishError, publishToChannel } from "../pubsub-handlers.js";
import { detectDatabaseNeed } from "../utils/databaseNeedDetector.js";
import { designDatabaseSchema } from "../utils/databaseSchemaDesigner.js";
import { provisionAndCreateTables } from "../utils/databaseProvisioner.js";
import { detectAuthenticationNeed, detectPaymentNeed } from "../utils/authPaymentDetector.js";
import { fetchIntegrationSpecs } from "../utils/integrationSpecsFetcher.js";
import { storeEnvVarRequirements, storeCredentialPlaceholders } from "../utils/envVarTracker.js";
import { calculateCost } from "../../utils/messageCostTracker.js";
import { nanoid } from "nanoid";
import { trackActivity } from "../utils/activityTracker.js";

/**
 * Agentic Execution Handler - Main orchestrator for backend project creation
 */
export async function handleProjectCreationOrchestration(job, requestId, streamId) {
  const { user_id, project_id, request_params } = job.data;
  const { userPrompt } = request_params;
  
  console.log(`[AgenticExecution] Starting for project: ${project_id}`);
  console.log(`[AgenticExecution] User request: "${userPrompt}"`);
  
  const client = await pool.connect();
  
  try {
    console.log(`[AgenticExecution] Step 1: Starting database transaction`);
    await client.query('BEGIN');
    console.log(`[AgenticExecution] Step 2: Transaction started`);

    // Initial progress
    console.log(`[AgenticExecution] Step 3: Publishing initial progress`);
    await publishProgress(streamId, "Starting execution...", 10);
    console.log(`[AgenticExecution] Step 4: Initial progress published`);

    // Phase 0.3: Auth & Payment Detection
    let authInfo = null;
    let paymentInfo = null;
    let authDetectionCost = 0;
    let paymentDetectionCost = 0;

    console.log(`[AgenticExecution] Phase 0.3: Detecting auth & payment requirements`);
    console.log(`[AgenticExecution] Step 5: Calling detectAuthenticationNeed...`);

    const authResult = await detectAuthenticationNeed(userPrompt);
    console.log(`[AgenticExecution] Step 6: Auth detection completed`);

    authDetectionCost = calculateCost(authResult.usage.inputTokens, authResult.usage.outputTokens, 'grok-4-fast');

    if (authResult.needsAuth) {
      authInfo = authResult;
      await publishProgress(streamId, "Authentication required - Clerk will be configured", 8);
      console.log(`[AgenticExecution] ✅ Auth required: ${authResult.reasoning}`);
    }

    console.log(`[AgenticExecution] Step 7: Calling detectPaymentNeed...`);
    const paymentResult = await detectPaymentNeed(userPrompt);
    console.log(`[AgenticExecution] Step 8: Payment detection completed`);
    paymentDetectionCost = calculateCost(paymentResult.usage.inputTokens, paymentResult.usage.outputTokens, 'grok-4-fast');

    if (paymentResult.needsPayments) {
      paymentInfo = paymentResult;
      await publishProgress(streamId, "Payment processing required - Stripe will be configured", 9);
      console.log(`[AgenticExecution] ✅ Payments required: ${paymentResult.reasoning}`);
    }
    console.log(`[AgenticExecution] Step 9: Auth & Payment detection phase complete`);


    // Phase 0.5: Database Detection & Provisioning (BEFORE Container)
    let databaseInfo = null;
    let dbDetectionCost = 0;
    let dbDesignCost = 0;

    console.log(`[AgenticExecution] Phase 0.5: Detecting database requirements`);
    console.log(`[AgenticExecution] Step 10: Calling detectDatabaseNeed...`);
    const detectionResult = await detectDatabaseNeed(userPrompt);
    console.log(`[AgenticExecution] Step 11: Database detection completed`);

    dbDetectionCost = calculateCost(detectionResult.usage.inputTokens, detectionResult.usage.outputTokens, 'grok-4-fast');
    
    if (detectionResult.needsDatabase) {
      await publishProgress(streamId, "Database required - designing schema...", 12);
      
      const schemaResult = await designDatabaseSchema(userPrompt);
      dbDesignCost = calculateCost(schemaResult.usage.inputTokens, schemaResult.usage.outputTokens, 'grok-4-fast');
      
      await publishProgress(streamId, "Provisioning database...", 15);
      
      databaseInfo = await provisionAndCreateTables(
        project_id,
        user_id,
        schemaResult.schema,
        client,
        requestId
      );
      
      await publishProgress(streamId, `Database provisioned: ${databaseInfo.dbName}`, 18);
      console.log(`[AgenticExecution] ✅ Database provisioned with ${databaseInfo.schema.tables.length} tables`);
    } else {
      console.log(`[AgenticExecution] No database required: ${detectionResult.reasoning}`);
    }
    
    // Phase 1: Container Setup (DETERMINISTIC)
    console.log(`[AgenticExecution] Phase 1: Provisioning container`);
    console.log(`[AgenticExecution] Step 12: Calling getOrProvisionContainer...`);
    const containerId = await getOrProvisionContainer(project_id, client, databaseInfo, authInfo, paymentInfo);
    console.log(`[AgenticExecution] Step 13: Container provisioned: ${containerId}`);
    await publishProgress(streamId, "Container provisioned", 20);


    // Load integration specs and examples if needed
    let integrationSpecs = null;
    if (authInfo || paymentInfo) {
      await publishProgress(streamId, "Loading integration specifications...", 25);
      integrationSpecs = await fetchIntegrationSpecs(authInfo, paymentInfo);
      await publishProgress(streamId, "Integration specs loaded", 28);
    }
    
    // Track project creation
    try {
      const sessionResult = await client.query(
        `SELECT session_id FROM ${process.env.PG_DB_SCHEMA}.container_sessions 
         WHERE project_id = $1 AND container_id = $2 
         ORDER BY started_at DESC LIMIT 1`,
        [project_id, containerId]
      );
      
      await trackActivity({
        projectId: project_id,
        userId: user_id,
        requestId,
        actionType: 'project_created',
        actionDetails: `Project created with container ${containerId}`,
        status: 'success',
        environment: 'development',
        referenceIds: {
          container_id: containerId,
          container_session_id: sessionResult.rows[0]?.session_id || null
        },
        client
      });
    } catch (error) {
      console.error(`[ActivityTracker] Failed to track project creation: ${error.message}`);
    }
    
    // Phase 2: Agentic Loop (AUTONOMOUS)
    console.log(`[AgenticExecution] Phase 2: Starting agentic loop`);
    await publishProgress(streamId, "Starting agentic loop", 30);
    const agentResult = await runAgenticLoop({
      containerId,
      projectId: project_id,
      userId: user_id,
      userRequest: userPrompt,
      requestId,
      databaseSchema: databaseInfo?.schema || null,
      integrationSpecs: integrationSpecs || null
    });
    await publishProgress(streamId, "Agentic loop complete", 70);
    
    // Inject CORS middleware deterministically
    console.log(`[AgenticExecution] Injecting CORS middleware...`);
    await injectCorsMiddleware(containerId, project_id);
    await publishProgress(streamId, "CORS configured", 72);
    
    // Commit database connection file if database was provisioned
    if (databaseInfo) {
      console.log(`[AgenticExecution] Committing database connection file...`);
      await executeCommandInContainer(containerId, 'git add server/utils/db.js');
      await executeCommandInContainer(containerId, 'git commit -m "Add database connection file"');
      await publishProgress(streamId, "Database connection file committed", 73);
    }
    
    // Inject GitHub Actions workflow
    console.log(`[AgenticExecution] Injecting GitHub Actions workflow...`);
    await injectGitHubActionsWorkflow(containerId, project_id);
    await publishProgress(streamId, "GitHub Actions configured", 74);
    
    // Create fly.toml and Dockerfile for deployment
    console.log(`[AgenticExecution] Creating fly.toml and Dockerfile...`);
    await createFlyToml(containerId, project_id);
    await publishProgress(streamId, "Deployment files created", 76);
    
    // Install flyctl in container
    console.log(`[AgenticExecution] Installing flyctl...`);
    await executeCommandInContainer(containerId, 'curl -L https://fly.io/install.sh | sh');
    await publishProgress(streamId, "flyctl installed", 77);
    
    // Create Fly.io app on platform
    console.log(`[AgenticExecution] Creating Fly.io app...`);
    const flyAppResult = await createFlyApp(containerId, project_id);
    if (!flyAppResult.success) {
      throw new Error(`Failed to create Fly.io app: ${flyAppResult.error || 'Unknown error'}`);
    }
    await publishProgress(streamId, "Fly.io app created", 78);
    
    // Set database secrets in Fly.io if database was provisioned
    if (databaseInfo) {
      console.log(`[AgenticExecution] Setting database secrets in Fly.io...`);
      const appName = `turbobackend-${project_id}`.toLowerCase();
      const secretsCommand = `export FLY_API_TOKEN="${process.env.FLY_API_TOKEN}" && ~/.fly/bin/flyctl secrets set DB_HOST="${databaseInfo.host}" DB_PORT="${databaseInfo.port}" DB_NAME="${databaseInfo.dbName}" DB_USER="${databaseInfo.user}" DB_PASSWORD="${databaseInfo.password}" --app ${appName}`;
      await executeCommandInContainer(containerId, secretsCommand);
      await publishProgress(streamId, "Database secrets configured in Fly.io", 79);
      console.log(`[AgenticExecution] ✅ Database secrets set in Fly.io`);
    }
    
    // Store deployment record in database (app created, deployment pending via GitHub Actions)
    // TODO: Later, implement GitHub Actions webhook to update deployment status when deployment completes
    const deploymentId = nanoid();
    const now = Math.floor(Date.now() / 1000);
    const appName = `turbobackend-${project_id}`.toLowerCase();
    const appUrl = `https://${appName}.fly.dev`;
    
    await client.query(
      `INSERT INTO ${process.env.PG_DB_SCHEMA}.project_deployments 
       (deployment_id, project_id, platform, app_name, url, status, deployed_at, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [deploymentId, project_id, 'flyio', appName, appUrl, 'pending', now, now]
    );
    
    console.log(`[AgenticExecution] Deployment record created: ${deploymentId} (status: pending)`);
    
    // Track endpoints added if any files were modified
    if (agentResult.filesModified?.length > 0) {
      try {
        const routeFiles = agentResult.filesModified.filter(f => 
          f.path && f.path.includes('/api/') && f.path.endsWith('.js')
        );
        
        if (routeFiles.length > 0) {
          const endpointList = routeFiles.map(f => {
            const fileName = f.path.split('/').pop();
            const method = fileName.split('.')[1]?.toUpperCase() || 'UNKNOWN';
            const path = f.path.replace(/^.*\/api\//, '/api/').replace(/\.[^.]+\.js$/, '');
            return `${method} ${path}`;
          }).join(', ');
          
          await trackActivity({
            projectId: project_id,
            userId: user_id,
            requestId,
            actionType: 'endpoints_added',
            actionDetails: `Added ${routeFiles.length} endpoints: ${endpointList}`,
            status: 'success',
            environment: 'development',
            client
          });
        }
      } catch (error) {
        console.error(`[ActivityTracker] Failed to track endpoints: ${error.message}`);
      }
    }
    
    // Phase 3: Post-Execution (DETERMINISTIC)
    console.log(`[AgenticExecution] Phase 3: Post-execution actions`);
    
    let githubPushResult = null;
    let s3UploadResult = null;
    let deploymentResult = null;
    
    if (agentResult.filesModified?.length > 0) {
      // Commit CORS, GitHub Actions, and deployment files
      console.log(`[AgenticExecution] Committing CORS, GitHub Actions, and deployment files...`);
      await executeCommandInContainer(containerId, 'git add server/middleware/00.cors.js .github/workflows/fly.yml fly.toml Dockerfile');
      await executeCommandInContainer(containerId, 'git commit -m "Add CORS middleware, GitHub Actions workflow, and Fly.io deployment files"');
      
      // Push to GitHub
      console.log(`[AgenticExecution] Pushing to GitHub...`);
      githubPushResult = await pushToGitHubDeterministic(
        containerId,
        project_id,
        agentResult.filesModified,
        client,
        user_id,
        requestId
      );
      await publishProgress(streamId, "Code pushed to GitHub", 80);
      
      // Set GitHub secret for Fly.io deployment
      console.log(`[AgenticExecution] Setting GitHub secret for Fly.io...`);
      try {
        await setGitHubSecret('SaaSManDan', `turbobackend-${project_id}`, 'FLY_API_TOKEN', process.env.FLY_API_TOKEN);
        console.log(`[AgenticExecution] ✅ GitHub secret set`);
      } catch (error) {
        console.error(`[AgenticExecution] Failed to set GitHub secret:`, error.message);
      }
      
      // Upload to S3
      console.log(`[AgenticExecution] Uploading to S3...`);
      const s3Path = await syncProjectToS3(containerId, project_id);
      s3UploadResult = {
        success: true,
        s3Path
      };
      await publishProgress(streamId, "Files uploaded to S3", 90);
    }

    // Save API blueprint to database and file if generated (MOVED BEFORE DEPLOYMENT)
    let blueprintId = null;
    if (agentResult.apiBlueprint) {
      console.log(`[AgenticExecution] Processing API blueprint from AI response`);
      
      // Get blueprint and remove any metadata
      const blueprint = { ...agentResult.apiBlueprint };
      
      // Remove metadata if AI included it (stored in DB instead)
      delete blueprint.projectId;
      delete blueprint.projectName;
      delete blueprint.version;
      delete blueprint.database; // Database schema stored separately
      
      // Write blueprint to file in container
      const blueprintJson = JSON.stringify(blueprint, null, 2);
      await writeFileInContainer(containerId, 'api-blueprint.json', blueprintJson);
      
      console.log(`[AgenticExecution] Created api-blueprint.json file`);
      
      // Commit to git
      await executeCommandInContainer(containerId, 'git add api-blueprint.json');
      await executeCommandInContainer(containerId, 'git commit -m "Add API blueprint"');
      
      // Store in database
      blueprintId = nanoid();
      const now = Math.floor(Date.now() / 1000);
      
      await client.query(
        `INSERT INTO ${process.env.PG_DB_SCHEMA}.api_blueprints 
         (blueprint_id, project_id, request_id, blueprint_content, last_updated, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [blueprintId, project_id, requestId, JSON.stringify(blueprint), now, now]
      );
      
      console.log(`[AgenticExecution] API blueprint saved: ${blueprintId}`);
    }

    // Store env var requirements and create placeholder credentials if auth or payments configured
    if (authInfo || paymentInfo) {
      await storeEnvVarRequirements(project_id, user_id, requestId, authInfo, paymentInfo, client);
      await storeCredentialPlaceholders(project_id, authInfo, paymentInfo, client);
    }

    await client.query('COMMIT');

    console.log(`[AgenticExecution] ✅ Pre-deployment tasks complete`);

    // Publish API blueprint if it exists
    if (blueprintId) {
      // Read the blueprint we just stored
      const blueprintResult = await client.query(
        `SELECT blueprint_content FROM ${process.env.PG_DB_SCHEMA}.api_blueprints
         WHERE blueprint_id = $1`,
        [blueprintId]
      );

      if (blueprintResult.rows.length > 0) {
        await publishToChannel(
          streamId,
          JSON.stringify({
            type: 'apiBlueprint',
            content: blueprintResult.rows[0].blueprint_content
          })
        );
        console.log(`[AgenticExecution] API blueprint published to stream`);
      }
    }

    // Calculate total cost
    const totalCost = (agentResult.totalCost || 0) + dbDetectionCost + dbDesignCost + authDetectionCost + paymentDetectionCost;

    // Build deployment URL
    const deploymentUrl = `https://turbobackend-${project_id}.fly.dev`;

    // Build and send success message BEFORE deployment
    const successParts = [];
    successParts.push(`✅ Project created successfully!`);
    successParts.push(`\nFiles modified: ${agentResult.filesModified?.length || 0}`);
    if (databaseInfo) {
      successParts.push(`Database: ${databaseInfo.dbName} (${databaseInfo.schema.tables.length} tables)`);
    }
    if (githubPushResult?.repoUrl) {
      successParts.push(`GitHub: ${githubPushResult.repoUrl}`);
    }
    if (s3UploadResult?.s3Path) {
      successParts.push(`S3: Files backed up`);
    }

    if (authInfo?.needsAuth) {
      successParts.push(`\n⚠️  CLERK: Add CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY to .env`);
    }

    if (paymentInfo?.needsPayments) {
      successParts.push(`⚠️  STRIPE: Add STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, and STRIPE_WEBHOOK_SECRET to .env`);
    }

    if (agentResult.apiBlueprint) {
      successParts.push(`\nAPI Blueprint: ${blueprintId}`);
    }
    if (agentResult.summary) {
      successParts.push(`Summary: ${agentResult.summary}`);
    }
    successParts.push(`Cost: $${totalCost.toFixed(4)}`);

    // Add deployment info
    successParts.push(`\n🚀 Deploying to: ${deploymentUrl}`);
    successParts.push(`(GitHub Actions deployment triggered, check ${githubPushResult?.repoUrl}/actions)`);

    await publishSuccess(streamId, successParts.join('\n'));

    // Deployment now handled by GitHub Actions
    // Comment out direct Fly.io deployment - GitHub Actions will handle it
    /*
    if (agentResult.filesModified?.length > 0 && githubPushResult) {
      console.log(`[AgenticExecution] Starting Fly.io deployment...`);
      const githubRepoUrl = githubPushResult.repoUrl;
      deploymentResult = await deployProjectToFlyIO(
        project_id,
        githubRepoUrl,
        containerId,
        client,
        databaseInfo,
        user_id,
        requestId
      );

      // Send deployment completion notification
      if (deploymentResult?.success) {
        await publishToChannel(
          streamId,
          JSON.stringify({
            type: 'deployment_complete',
            url: deploymentUrl,
            status: 'success'
          })
        );
        console.log(`[AgenticExecution] ✅ Deployment successful: ${deploymentUrl}`);
      } else {
        await publishToChannel(
          streamId,
          JSON.stringify({
            type: 'deployment_complete',
            url: deploymentUrl,
            status: 'failed',
            error: deploymentResult?.error || 'Unknown error'
          })
        );
        console.log(`[AgenticExecution] ❌ Deployment failed`);
      }
    }
    */
    
    // Notify that GitHub Actions will handle deployment
    if (agentResult.filesModified?.length > 0 && githubPushResult) {
      await publishToChannel(
        streamId,
        JSON.stringify({
          type: 'deployment_triggered',
          url: deploymentUrl,
          status: 'pending',
          message: 'GitHub Actions deployment triggered'
        })
      );
      console.log(`[AgenticExecution] ✅ GitHub Actions deployment triggered: ${deploymentUrl}`);
    }
    
    return {
      success: true,
      requestId,
      containerId,
      iterations: agentResult.iterations,
      filesModified: agentResult.filesModified,
      authInfo,
      paymentInfo,
      databaseInfo,
      agentSummary: agentResult.summary,
      totalCost: (agentResult.totalCost || 0) + dbDetectionCost + dbDesignCost + authDetectionCost + paymentDetectionCost,
      githubPushResult,
      s3UploadResult,
      deploymentResult
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[AgenticExecution] ❌ Error:`, error);
    
    // Publish error to stream
    const errorMessage = `Execution failed: ${error.message || 'Unknown error'}`;
    await publishError(streamId, errorMessage);
    
    throw error;
  } finally {
    client.release();
  }
}
