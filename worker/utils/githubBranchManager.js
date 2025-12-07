import { executeCommandInContainer } from "../services/daytonaService.js";

export async function getProjectGitHubRepo(projectId, client) {
    const result = await client.query(
        `SELECT * FROM ${process.env.PG_DB_SCHEMA}.project_github_repos 
     WHERE project_id = $1 AND is_active = true 
     ORDER BY created_at DESC 
     LIMIT 1`,
        [projectId],
    );

    if (result.rows.length === 0) {
        throw new Error(
            `No GitHub repository found for project ${projectId}`,
        );
    }

    return result.rows[0];
}

export async function cloneProjectFromGitHub(containerId, repoInfo) {
    const { repo_url, branch } = repoInfo;

    console.log(`[GitHub] Cloning ${repo_url} (branch: ${branch})`);
    console.log(`[GitHub] Container ID: ${containerId}`);

    // Check directory contents before cloning
    console.log(`[GitHub] Checking directory contents before clone...`);
    try {
        const lsResult = await executeCommandInContainer(containerId, "ls -la");
        console.log(`[GitHub] Directory contents before clone:`, lsResult);
    } catch (error) {
        console.error(`[GitHub] Error checking directory:`, error);
    }

    // Clone with authentication using git init approach (works with non-empty directories)
    const authenticatedUrl = repo_url.replace(
        "https://",
        `https://${process.env.GITHUB_ACCESS_TOKEN}@`,
    );

    console.log(`[GitHub] Initializing git repository...`);
    const initResult = await executeCommandInContainer(containerId, "git init");
    console.log(`[GitHub] Git init result:`, initResult);
    if (initResult.exitCode !== 0) {
        throw new Error(`Git init failed: ${initResult.result}`);
    }

    console.log(`[GitHub] Adding remote origin...`);
    const remoteResult = await executeCommandInContainer(
        containerId,
        `git remote add origin ${authenticatedUrl}`,
    );
    console.log(`[GitHub] Git remote result:`, remoteResult);
    if (remoteResult.exitCode !== 0) {
        throw new Error(`Git remote add failed: ${remoteResult.result}`);
    }

    console.log(`[GitHub] Fetching from origin...`);
    const fetchResult = await executeCommandInContainer(
        containerId,
        `git fetch origin ${branch}`,
    );
    console.log(`[GitHub] Git fetch result:`, fetchResult);
    if (fetchResult.exitCode !== 0) {
        throw new Error(`Git fetch failed: ${fetchResult.result}`);
    }

    console.log(`[GitHub] Checking out branch ${branch}...`);
    const checkoutResult = await executeCommandInContainer(
        containerId,
        `git checkout ${branch}`,
    );
    console.log(`[GitHub] Git checkout result:`, checkoutResult);
    if (checkoutResult.exitCode !== 0) {
        throw new Error(`Git checkout failed: ${checkoutResult.result}`);
    }

    // Check directory contents after cloning
    console.log(`[GitHub] Checking directory contents after clone...`);
    try {
        const lsAfterResult = await executeCommandInContainer(containerId, "ls -la");
        console.log(`[GitHub] Directory contents after clone:`, lsAfterResult);
    } catch (error) {
        console.error(`[GitHub] Error checking directory after clone:`, error);
    }

    // Configure git
    console.log(`[GitHub] Configuring git user...`);
    await executeCommandInContainer(
        containerId,
        'git config user.name "TurboBackend Agent"',
    );
    await executeCommandInContainer(
        containerId,
        'git config user.email "agent@turbobackend.dev"',
    );

    console.log(`[GitHub] ✅ Project cloned successfully`);
}

export async function createFeatureBranch(containerId, branchName) {
    console.log(`[GitHub] Creating feature branch: ${branchName}`);

    await executeCommandInContainer(
        containerId,
        `git checkout -b ${branchName}`,
    );

    console.log(`[GitHub] Feature branch created`);
}

export async function commitChanges(containerId, commitMessage) {
    console.log(`[GitHub] Committing changes`);

    await executeCommandInContainer(containerId, "git add .");
    await executeCommandInContainer(
        containerId,
        `git commit -m "${commitMessage}"`,
    );

    console.log(`[GitHub] Changes committed`);
}

export async function pushFeatureBranch(containerId, branchName) {
    console.log(`[GitHub] Pushing feature branch: ${branchName}`);

    await executeCommandInContainer(
        containerId,
        `git push origin ${branchName}`,
    );

    console.log(`[GitHub] Feature branch pushed`);
}

export async function mergeFeatureBranch(containerId, branchName) {
    console.log(`[GitHub] Merging ${branchName} to main`);

    await executeCommandInContainer(containerId, "git checkout main");
    await executeCommandInContainer(
        containerId,
        `git merge ${branchName}`,
    );

    console.log(`[GitHub] Feature branch merged`);
}

export async function pushToMain(containerId) {
    console.log(`[GitHub] Pushing to main branch`);

    await executeCommandInContainer(containerId, "git push origin main");

    console.log(`[GitHub] Main branch updated`);
}
