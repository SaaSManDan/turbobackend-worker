import {
  executeCommandInContainer,
  writeFileInContainer,
  readFileFromContainer,
  deleteFileInContainer
} from "../services/daytonaService.js";

/**
 * Execute commands requested by the agent
 */
export async function executeAgentCommands(containerId, commands) {
  const results = [];
  
  for (const cmd of commands) {
    try {
      let result;
      
      switch (cmd.type) {
        case 'execute':
          result = await executeCommandInContainer(containerId, cmd.command);
          break;
          
        case 'write':
          result = await writeFileInContainer(containerId, cmd.path, cmd.content);
          break;
          
        case 'read':
          result = await readFileFromContainer(containerId, cmd.path);
          break;
          
        case 'delete':
          result = await deleteFileInContainer(containerId, cmd.path);
          break;
          
        case 'db_query':
          // Just store the query, don't execute yet
          result = { stored: true, query: cmd.query };
          break;
          
        default:
          throw new Error(`Unknown command type: ${cmd.type}`);
      }
      
      results.push({
        command: cmd,
        success: true,
        result
      });
      
    } catch (error) {
      results.push({
        command: cmd,
        success: false,
        error: error.message
      });
    }
  }
  
  return results;
}
