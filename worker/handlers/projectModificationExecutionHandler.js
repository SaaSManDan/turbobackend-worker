import pool from "../../databases/postgresConnector.js";
import { provisionDaytonaContainer, readFileFromContainer } from "../services/daytonaService.js";
import { runAgenticLoop } from "../llms/agenticLoopExecutor.js";
import { deployProjectToFlyIO } from "../services/flyioService.js";
import {
    publishProgress,
    publishSuccess,
    publishError,
    publishToChannel,
} from "../pubsub-handlers.js";
import { loadProjectContext } from "../utils/projectContextLoader.js";
import { trackActivity } from "../utils/activityTracker.js";
import {
    getProjectGitHubRepo,
    cloneProjectFromGitHub,
    createFeatureBranch,
    commitChanges,
    pushFeatureBranch,
    mergeFeatureBranch,
    pushToMain,
} from "../utils/githubBranchManager.js";
import { nanoid } from "nanoid";

export async function handleProjectModificationOrchestration(
    job,
    requestId,
    streamId,
) {
    const { user_id, project_id, request_params } = job.data;
    const { modificationRequest, shouldRedeploy = true } = request_params;

    console.log(`[ProjectModification] Starting for project: ${project_id}`);
    console.log(`[ProjectModification] Request: "${modificationRequest}"`);

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await publishProgress(streamId, "Provisioning new sandbox...", 10);

        // Phase 1: Provision new sandbox
        console.log(
            `[ProjectModification] Phase 1: Provisioning new sandbox`,
        );
        const containerId = await provisionDaytonaContainer(project_id);
        await publishProgress(streamId, "Sandbox provisioned", 15);

        // Phase 2: Get GitHub repo URL
        console.log(
            `[ProjectModification] Phase 2: Getting GitHub repository`,
        );
        const repoInfo = await getProjectGitHubRepo(project_id, client);
        await publishProgress(streamId, "Repository found", 20);

        // Phase 3: Clone project from GitHub
        console.log(
            `[ProjectModification] Phase 3: Cloning project from GitHub`,
        );
        await cloneProjectFromGitHub(containerId, repoInfo);
        await publishProgress(streamId, "Project cloned", 25);

        // Phase 4: Create feature branch
        const branchName = `feature/modification-${Date.now()}`;
        console.log(
            `[ProjectModification] Phase 4: Creating feature branch: ${branchName}`,
        );
        await createFeatureBranch(containerId, branchName);
        await publishProgress(
            streamId,
            `Feature branch created: ${branchName}`,
            30,
        );

        // Phase 5: Load project context
        console.log(
            `[ProjectModification] Phase 5: Loading project context`,
        );
        const projectContext = await loadProjectContext(
            containerId,
            project_id,
            client,
        );
        await publishProgress(streamId, "Project context loaded", 35);

        // Phase 6: Run agentic loop with modification context
        console.log(
            `[ProjectModification] Phase 6: Starting modification loop`,
        );
        await publishProgress(streamId, "Processing modifications", 40);

        const agentResult = await runAgenticLoop({
            containerId,
            projectId: project_id,
            userId: user_id,
            userRequest: modificationRequest,
            requestId,
            databaseSchema: projectContext.databaseSchema,
            existingFiles: projectContext.files,
            existingEndpoints: projectContext.endpoints,
        });

        await publishProgress(streamId, "Modifications complete", 70);

        // Phase 7: Handle new database tables if needed
        if (agentResult.dbQueries?.length > 0) {
            console.log(`[ProjectModification] Adding new database tables`);
            // Extract CREATE TABLE queries
            const createTableQueries = agentResult.dbQueries.filter(
                function (q) {
                    return q.type === "CREATE TABLE";
                },
            );

            if (createTableQueries.length > 0) {
                // Add tables to existing database
                await addTablesToExistingDatabase(
                    project_id,
                    user_id,
                    createTableQueries,
                    client,
                    requestId,
                );

                await trackActivity({
                    projectId: project_id,
                    userId: user_id,
                    requestId,
                    actionType: "tables_added",
                    actionDetails: `Added ${createTableQueries.length} new tables`,
                    status: "success",
                    environment: "development",
                    client,
                });
            }
        }

        // Phase 8: Commit and push feature branch
        console.log(
            `[ProjectModification] Phase 8: Committing changes to feature branch`,
        );
        await commitChanges(containerId, `Modification: ${modificationRequest}`);
        await pushFeatureBranch(containerId, branchName);
        await publishProgress(streamId, "Feature branch pushed", 80);

        // Phase 9: Merge feature branch to main
        console.log(
            `[ProjectModification] Phase 9: Merging feature branch to main`,
        );
        await mergeFeatureBranch(containerId, branchName);
        await pushToMain(containerId);
        await publishProgress(streamId, "Changes merged to main", 85);
        
        // Phase 9.5: Check if API blueprint was modified
        const blueprintModified = agentResult.filesModified?.some(function(f) {
            return f.path === 'api-blueprint.json';
        });
        
        if (blueprintModified) {
            console.log(`[ProjectModification] Extracting updated API blueprint from container`);
            
            try {
                // Read the updated blueprint from container
                const blueprintContent = await readFileFromContainer(containerId, 'api-blueprint.json');
                const blueprint = JSON.parse(blueprintContent);
                
                // Update database record
                const now = Math.floor(Date.now() / 1000);
                await client.query(
                    `UPDATE ${process.env.PG_DB_SCHEMA}.api_blueprints 
                     SET blueprint_content = $1, last_updated = $2
                     WHERE project_id = $3`,
                    [JSON.stringify(blueprint), now, project_id]
                );
                
                // Publish to stream
                await publishToChannel(
                    streamId,
                    JSON.stringify({
                        type: 'apiBlueprint',
                        content: blueprint
                    })
                );
                
                console.log(`[ProjectModification] API blueprint updated and published`);
            } catch (error) {
                console.error(`[ProjectModification] Failed to update API blueprint: ${error.message}`);
                // Don't fail the whole modification if blueprint update fails
            }
        }

        // Track GitHub push activity
        await trackActivity({
            projectId: project_id,
            userId: user_id,
            requestId,
            actionType: "github_push",
            actionDetails: `Pushed ${agentResult.filesModified?.length || 0} modified files to ${repoInfo.repo_url}`,
            status: "success",
            environment: "development",
            referenceIds: {
                branch_name: branchName,
            },
            client,
        });

        // Track modification activity
        if (agentResult.filesModified?.length > 0) {
            const modificationType = determineModificationType(
                agentResult.filesModified,
            );
            await trackActivity({
                projectId: project_id,
                userId: user_id,
                requestId,
                actionType: modificationType,
                actionDetails: `${modificationRequest} (${agentResult.filesModified.length} files changed)`,
                status: "success",
                environment: "development",
                referenceIds: {
                    branch_name: branchName,
                },
                client,
            });
        }

        // Phase 10: Redeploy if requested
        let deploymentResult = null;
        if (shouldRedeploy) {
            console.log(
                `[ProjectModification] Phase 10: Redeploying to Fly.io`,
            );
            deploymentResult = await deployProjectToFlyIO(
                project_id,
                repoInfo.repo_url,
                containerId,
                client,
                projectContext.databaseInfo,
                user_id,
                requestId,
            );
            await publishProgress(streamId, "Redeployment complete", 95);
        }

        // Phase 11: Record container session
        const sessionId = nanoid();
        const now = Math.floor(Date.now() / 1000);
        await client.query(
            `INSERT INTO ${process.env.PG_DB_SCHEMA}.container_sessions
       (session_id, project_id, container_id, container_provider, status, environment, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                sessionId,
                project_id,
                containerId,
                "daytona",
                "completed",
                "development",
                now,
            ],
        );

        await client.query("COMMIT");

        console.log(`[ProjectModification] ✅ Modification complete`);

        const successMessage = `Project modifications completed successfully!\n\nFiles modified: ${agentResult.filesModified?.length || 0}\n${deploymentResult ? `Redeployed to: ${deploymentResult.url}` : ""}\n\nSummary: ${agentResult.summary}`;

        await publishSuccess(streamId, successMessage);

        return {
            success: true,
            requestId,
            containerId,
            branchName,
            filesModified: agentResult.filesModified,
            deploymentResult,
        };
    } catch (error) {
        await client.query("ROLLBACK");
        console.error(`[ProjectModification] ❌ Error:`, error);

        await publishError(
            streamId,
            `Modification failed: ${error.message}`,
        );

        throw error;
    } finally {
        client.release();
    }
}

function determineModificationType(filesModified) {
    const hasNewRoutes = filesModified.some(function (f) {
        return f.type === "route" && f.isNew;
    });
    const hasModifiedRoutes = filesModified.some(function (f) {
        return f.type === "route" && !f.isNew;
    });

    if (hasNewRoutes) return "endpoints_added";
    if (hasModifiedRoutes) return "endpoints_modified";
    return "business_logic_modified";
}

async function addTablesToExistingDatabase(
    projectId,
    userId,
    createTableQueries,
    client,
    requestId,
) {
    // Get existing database info
    const dbResult = await client.query(
        `SELECT * FROM ${process.env.PG_DB_SCHEMA}.project_databases 
     WHERE project_id = $1 AND is_active = true`,
        [projectId],
    );

    if (dbResult.rows.length === 0) {
        throw new Error("No active database found for project");
    }

    const dbInfo = dbResult.rows[0];

    // Execute CREATE TABLE queries on existing database
    console.log(
        `[ProjectModification] Adding ${createTableQueries.length} tables to ${dbInfo.db_name}`,
    );

    // TODO: Execute queries on existing database
    // This would be similar to the logic in databaseProvisioner.js
    // but connecting to the existing database instead of creating a new one
}
