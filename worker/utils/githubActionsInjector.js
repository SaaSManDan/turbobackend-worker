import { writeFileInContainer, executeCommandInContainer } from '../services/daytonaService.js';

/**
 * Inject GitHub Actions workflow for Fly.io deployment
 */
export async function injectGitHubActionsWorkflow(containerId, projectId) {
  console.log(`[GitHubActions] Injecting workflow for project ${projectId}`);

  const workflowContent = `name: Deploy to Fly.io
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
          FLY_API_TOKEN: \${{ secrets.FLY_API_TOKEN }}
`;

  await writeFileInContainer(containerId, '.github/workflows/fly.yml', workflowContent);
  
  console.log(`[GitHubActions] ✅ Workflow file created`);
  
  return { success: true };
}

/**
 * Set GitHub repository secret via API
 */
export async function setGitHubSecret(repoOwner, repoName, secretName, secretValue) {
  console.log(`[GitHubActions] Setting secret ${secretName} for ${repoOwner}/${repoName}`);

  try {
    // Step 1: Get repository public key
    const keyResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/actions/secrets/public-key`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${process.env.GITHUB_ACCESS_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    );

    if (!keyResponse.ok) {
      const errorData = await keyResponse.json();
      throw new Error(`Failed to get public key: ${errorData.message}`);
    }

    const { key, key_id } = await keyResponse.json();

    // Step 2: Encrypt the secret using libsodium
    const sodiumModule = await import('libsodium-wrappers');
    const sodium = sodiumModule.default;
    await sodium.ready;

    const binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
    const binsec = sodium.from_string(secretValue);
    const encBytes = sodium.crypto_box_seal(binsec, binkey);
    const encrypted_value = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);

    // Step 3: Set the secret
    const secretResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/actions/secrets/${secretName}`,
      {
        method: 'PUT',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${process.env.GITHUB_ACCESS_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          encrypted_value,
          key_id
        })
      }
    );

    if (!secretResponse.ok) {
      const errorData = await secretResponse.json();
      throw new Error(`Failed to set secret: ${errorData.message}`);
    }

    console.log(`[GitHubActions] ✅ Secret ${secretName} set successfully`);
    return { success: true };

  } catch (error) {
    console.error(`[GitHubActions] Error setting secret:`, error);
    throw error;
  }
}
