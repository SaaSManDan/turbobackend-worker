import { writeFileInContainer, executeCommandInContainer } from '../services/daytonaService.js';

/**
 * Inject CORS middleware for Nitro.js projects
 */
export async function injectCorsMiddleware(containerId, projectId) {
  console.log(`[CORS] Injecting CORS middleware for project ${projectId}`);

  const corsMiddleware = `export default defineEventHandler(function(event) {
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization,content-type'
  });
  
  if (event.method === 'OPTIONS') {
    event.node.res.statusCode = 200;
    return 'OK';
  }
});
`;

  await writeFileInContainer(containerId, 'server/middleware/00.cors.js', corsMiddleware);
  
  console.log(`[CORS] ✅ CORS middleware created`);
  
  return { success: true };
}
