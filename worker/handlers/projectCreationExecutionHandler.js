import pool from "../../databases/postgresConnector.js";
import { getOrProvisionContainer, syncProjectToS3, writeFileInContainer, executeCommandInContainer } from "../services/daytonaService.js";
import { runAgenticLoop } from "../llms/agenticLoopExecutor.js";
import { pushToGitHubDeterministic } from "../utils/githubIntegration.js";
import { deployProjectToFlyIO } from "../services/flyioService.js";
import { publishProgress, publishSuccess, publishError, publishToChannel } from "../pubsub-handlers.js";
import { detectDatabaseNeed } from "../utils/databaseNeedDetector.js";
import { designDatabaseSchema } from "../utils/databaseSchemaDesigner.js";
import { provisionAndCreateTables } from "../utils/databaseProvisioner.js";
import { detectAuthenticationNeed, detectPaymentNeed } from "../utils/authPaymentDetector.js";
import { fetchIntegrationSpecs } from "../utils/integrationSpecsFetcher.js";
import { storeEnvVarRequirements } from "../utils/envVarTracker.js";
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

    authDetectionCost = calculateCost(authResult.usage.inputTokens, authResult.usage.outputTokens, 'grok-2-1212');

    if (authResult.needsAuth) {
      authInfo = authResult;
      await publishProgress(streamId, "Authentication required - Clerk will be configured", 8);
      console.log(`[AgenticExecution] ✅ Auth required: ${authResult.reasoning}`);
    }

    console.log(`[AgenticExecution] Step 7: Calling detectPaymentNeed...`);
    const paymentResult = await detectPaymentNeed(userPrompt);
    console.log(`[AgenticExecution] Step 8: Payment detection completed`);
    paymentDetectionCost = calculateCost(paymentResult.usage.inputTokens, paymentResult.usage.outputTokens, 'grok-2-1212');

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

    dbDetectionCost = calculateCost(detectionResult.usage.inputTokens, detectionResult.usage.outputTokens, 'grok-2-1212');
    
    if (detectionResult.needsDatabase) {
      await publishProgress(streamId, "Database required - designing schema...", 12);
      
      const schemaResult = await designDatabaseSchema(userPrompt);
      dbDesignCost = calculateCost(schemaResult.usage.inputTokens, schemaResult.usage.outputTokens, 'grok-2-1212');
      
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
      
      // Upload to S3
      console.log(`[AgenticExecution] Uploading to S3...`);
      const s3Path = await syncProjectToS3(containerId, project_id);
      s3UploadResult = {
        success: true,
        s3Path
      };
      await publishProgress(streamId, "Files uploaded to S3", 90);
      
      // Deploy to Fly.io
      console.log(`[AgenticExecution] Deploying to Fly.io...`);
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
      await publishProgress(streamId, "Deployment complete", 95);
    }
    
    // Save API blueprint to database and file if generated
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

    // Store env var requirements if auth or payments configured
    if (authInfo || paymentInfo) {
      await storeEnvVarRequirements(project_id, user_id, requestId, authInfo, paymentInfo, client);
    }

    await client.query('COMMIT');
    
    console.log(`[AgenticExecution] ✅ Execution complete`);
    
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
    
    // Build success message
    const successParts = [];
    successParts.push(`Project execution completed successfully!`);
    successParts.push(`\nFiles modified: ${agentResult.filesModified?.length || 0}`);
    if (databaseInfo) {
      successParts.push(`Database created: ${databaseInfo.dbName} (${databaseInfo.schema.tables.length} tables)`);
    }

    if (authInfo?.needsAuth) {
      successParts.push(`\n⚠️  CLERK AUTHENTICATION: Add CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY to your .env file to enable authentication features.`);
    }

    if (paymentInfo?.needsPayments) {
      successParts.push(`\n⚠️  STRIPE PAYMENTS: Add STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, and STRIPE_WEBHOOK_SECRET to your .env file to enable payment processing.`);
    }

    if (deploymentResult?.deploymentUrl) {
      successParts.push(`Deployment URL: ${deploymentResult.deploymentUrl}`);
    }
    if (agentResult.apiBlueprint) {
      successParts.push(`\nAPI Blueprint generated (ID: ${blueprintId})`);
    }
    if (agentResult.summary) {
      successParts.push(`\nSummary: ${agentResult.summary}`);
    }
    const totalCost = (agentResult.totalCost || 0) + dbDetectionCost + dbDesignCost + authDetectionCost + paymentDetectionCost;
    successParts.push(`\nTotal cost: $${totalCost.toFixed(4)}`);
    
    await publishSuccess(streamId, successParts.join('\n'));
    
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
