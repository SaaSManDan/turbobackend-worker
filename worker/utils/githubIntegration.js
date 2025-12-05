import { nanoid } from "nanoid";
import { executeCommandInContainer } from "../services/daytonaService.js";
import { trackActivity } from "./activityTracker.js";

/**
 * Push to GitHub deterministically (automatic git commands after agent completes)
 */
export async function pushToGitHubDeterministic(containerId, projectId, filesModified, client, userId = null, requestId = null) {
  console.log(`[GitHub] Starting deterministic push for project ${projectId}`);

  let commitMessage; // Declare at function scope

  // Step 1: Check if remote exists
  const remoteResult = await executeCommandInContainer(containerId, 'git remote -v');

  if (!remoteResult.stdout || !remoteResult.stdout.includes('origin')) {
    // Step 2: Create GitHub repo
    console.log(`[GitHub] Creating new GitHub repository`);
    const repoUrl = await createGitHubRepo(projectId);

    // Step 3: Git init (if necessary - should already be done in initializeNitroProject)
    console.log(`[GitHub] Ensuring git is initialized`);
    await executeCommandInContainer(containerId, 'git init');

    // Step 4: Stage all changes (including AI-created files)
    console.log(`[GitHub] Staging all files`);
    await executeCommandInContainer(containerId, 'git add .');

    // Step 5: Commit changes
    commitMessage = `Initial commit - Backend project files`;
    console.log(`[GitHub] Committing changes`);
    await executeCommandInContainer(containerId, `git commit -m "${commitMessage}"`);

    // Step 6: Add remote with authenticated URL
    const authenticatedUrl = repoUrl.replace('https://', `https://${process.env.GITHUB_ACCESS_TOKEN}@`);
    console.log(`[GitHub] Adding remote origin`);
    await executeCommandInContainer(containerId, `git remote add origin ${authenticatedUrl}`);

    // Step 7: Set branch to main
    console.log(`[GitHub] Setting branch to main`);
    await executeCommandInContainer(containerId, 'git branch -M main');

    // Step 8: Push to GitHub
    console.log(`[GitHub] Pushing to GitHub`);
    const pushResult = await executeCommandInContainer(containerId, 'git push origin main');

    console.log('[GitHub] pushResult:', JSON.stringify(pushResult));

    if (pushResult.exitCode !== 0) {
      console.error(`[GitHub] Push failed:`, pushResult);
      throw new Error(`Git push failed: ${JSON.stringify(pushResult)}`);
    }

    // Save repo info to database
    const repoId = nanoid();
    const now = Math.floor(Date.now() / 1000);

    await client.query(
      `INSERT INTO ${process.env.PG_DB_SCHEMA}.project_github_repos
       (repo_id, project_id, user_id, repo_url, repo_name, branch, is_active, environment, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [repoId, projectId, 'user_id', repoUrl, `turbobackend-${projectId}`, 'main', true, 'development', now, now]
    );
  } else {
    // Remote already exists - this is a subsequent push
    console.log(`[GitHub] Remote already exists, pushing updates`);

    // Check if there are any uncommitted changes
    const gitStatus = await executeCommandInContainer(containerId, 'git status --porcelain');

    if (!gitStatus.stdout || gitStatus.stdout.trim() === '') {
      console.log(`[GitHub] No uncommitted changes, but will push existing commits`);
      commitMessage = 'Backend project files';
    } else {
      // Stage and commit new changes
      await executeCommandInContainer(containerId, 'git add .');
      commitMessage = `Update backend files - ${new Date().toISOString()}`;
      await executeCommandInContainer(containerId, `git commit -m "${commitMessage}"`);
    }

    // Push to GitHub
    const pushResult = await executeCommandInContainer(containerId, 'git push origin main');

    console.log('[GitHub] pushResult:', JSON.stringify(pushResult));

    if (pushResult.exitCode !== 0) {
      console.error(`[GitHub] Push failed:`, pushResult);
      throw new Error(`Git push failed: ${JSON.stringify(pushResult)}`);
    }
  }

  console.log('[GitHub] ✅ Successfully pushed to GitHub');

  // Get commit info for recording
  const commitShaResult = await executeCommandInContainer(containerId, 'git rev-parse HEAD');

  console.log('[GitHub] commitShaResult:', JSON.stringify(commitShaResult));

  if (!commitShaResult || !commitShaResult.result) {
    throw new Error(`Failed to get commit SHA. Result: ${JSON.stringify(commitShaResult)}`);
  }

  const commitSha = commitShaResult.result.trim();

  const repoUrlResult = await executeCommandInContainer(containerId, 'git config --get remote.origin.url');

  console.log('[GitHub] repoUrlResult:', JSON.stringify(repoUrlResult));

  if (!repoUrlResult || !repoUrlResult.result) {
    throw new Error(`Failed to get repo URL. Result: ${JSON.stringify(repoUrlResult)}`);
  }

  const repoUrl = repoUrlResult.result.trim().replace(/https:\/\/.*@/, 'https://');

  // Record in database
  const pushId = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await client.query(
    `INSERT INTO ${process.env.PG_DB_SCHEMA}.github_push_history
     (push_id, project_id, commit_sha, commit_message, files_changed, repo_url, environment, pushed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      pushId,
      projectId,
      commitSha,
      commitMessage,
      JSON.stringify(filesModified.map(f => f.path)),
      repoUrl,
      'development',
      now
    ]
  );

  console.log(`[GitHub] ✅ Pushed commit: ${commitSha}`);

  // Track GitHub push activity
  if (userId) {
    try {
      await trackActivity({
        projectId,
        userId,
        requestId,
        actionType: 'github_push',
        actionDetails: `Pushed ${filesModified.length} files to ${repoUrl}`,
        status: 'success',
        environment: 'development',
        referenceIds: {
          github_push_id: pushId,
          commit_sha: commitSha
        },
        client
      });
    } catch (error) {
      console.error(`[ActivityTracker] Failed to track GitHub push: ${error.message}`);
    }
  }

  return {
    success: true,
    commitSha,
    commitMessage,
    filesCount: filesModified.length,
    repoUrl
  };
}

async function createGitHubRepo(projectId) {
  // TODO: Implement GitHub API call to create repository
  const repoName = `turbobackend-${projectId}`;

  const body = {
    name: repoName,
    private: true,
    auto_init: false
  };
  
  try {
    const response = await fetch("https://api.github.com/user/repos", {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${process.env.GITHUB_ACCESS_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorData = await response.json();

      console.log(`[GitHub] API error response:`, JSON.stringify(errorData));

      // Check if repo already exists (422 error)
      if (response.status === 422) {
        const errorMsg = JSON.stringify(errorData).toLowerCase();
        if (errorMsg.includes('already') || errorMsg.includes('exist')) {
          console.log(`[GitHub] Repository already exists, using existing repo: ${repoName}`);
          // Return the clone URL for the existing repo
          return `https://github.com/SaaSManDan/${repoName}.git`;
        }
      }

      throw new Error(`GitHub API error: ${response.status} - ${errorData.message || JSON.stringify(errorData)}`);
    }

    const repoData = await response.json();

    return repoData.clone_url;

  } catch(err){
    console.error(`[GitHub] Error creating GitHub repo: ${err.message}`);
    throw err;
  }
}
