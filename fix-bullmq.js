import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';

// Fix BullMQ directory imports for Node.js v23 compatibility
async function fixBullMQImports() {
  const files = await glob('node_modules/bullmq/dist/esm/**/*.js');
  
  for (const file of files) {
    let content = readFileSync(file, 'utf8');
    const original = content;
    
    // Replace directory imports with explicit index.js
    content = content.replace(/from ['"](\.\.[\/\\]enums)['"]/g, "from '$1/index.js'");
    
    // Fix relative imports without .js extension
    content = content.replace(/from ['"](\.\/[^'"]+?)(?<!\.js)['"]/g, "from '$1.js'");
    content = content.replace(/from ['"](\.\.\/[^'"]+?)(?<!\.js)(?<!\/index\.js)['"]/g, "from '$1.js'");
    
    if (content !== original) {
      writeFileSync(file, content, 'utf8');
      console.log(`Fixed: ${file}`);
    }
  }
  
  console.log('BullMQ imports fixed for Node.js v23');
}

fixBullMQImports().catch(console.error);
