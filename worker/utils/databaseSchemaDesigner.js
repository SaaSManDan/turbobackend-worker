import { callLLMNonStream } from "../llms/xai-non-stream.js";

/**
 * Design database schema based on user's request
 */
export async function designDatabaseSchema(userPrompt) {
  console.log(`[SchemaDesigner] Designing database schema...`);
  
  const designPrompt = `Design a Postgres database schema for this application.

User Request: "${userPrompt}"

Requirements:
- Use varchar for all ID columns (we use nano IDs)
- Use bigint for all timestamp columns (unix time in seconds)
- Use appropriate data types for other fields
- Include necessary constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE, NOT NULL)
- Keep it simple and focused on the core requirements

Return JSON only in this exact format:
{
  "tables": [
    {
      "tableName": "table_name",
      "columns": [
        {"name": "column_name", "type": "data_type", "constraints": "constraints"}
      ],
      "createQuery": "CREATE TABLE table_name (column_name data_type constraints, ...);"
    }
  ]
}

Example:
{
  "tables": [
    {
      "tableName": "users",
      "columns": [
        {"name": "user_id", "type": "varchar", "constraints": "PRIMARY KEY"},
        {"name": "email", "type": "varchar", "constraints": "UNIQUE NOT NULL"},
        {"name": "created_at", "type": "bigint", "constraints": "NOT NULL"}
      ],
      "createQuery": "CREATE TABLE users (user_id varchar PRIMARY KEY, email varchar UNIQUE NOT NULL, created_at bigint NOT NULL);"
    }
  ]
}`;

  try {
    const result = await callLLMNonStream(designPrompt, null);
    const response = JSON.parse(result.text);
    
    console.log(`[SchemaDesigner] Designed ${response.tables.length} tables`);
    response.tables.forEach(function(table) {
      console.log(`[SchemaDesigner] - ${table.tableName} (${table.columns.length} columns)`);
    });
    
    return {
      schema: response,
      usage: result.usage
    };
  } catch (error) {
    console.error(`[SchemaDesigner] Error designing schema:`, error);
    throw new Error(`Schema design failed: ${error.message}`);
  }
}
