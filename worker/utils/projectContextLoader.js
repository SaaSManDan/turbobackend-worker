import { executeCommandInContainer } from "../services/daytonaService.js";

export async function loadProjectContext(containerId, projectId, client) {
    console.log(`[ContextLoader] Loading context for project ${projectId}`);

    // Get database info
    const dbResult = await client.query(
        `SELECT * FROM ${process.env.PG_DB_SCHEMA}.project_databases 
     WHERE project_id = $1 AND is_active = true`,
        [projectId],
    );

    const databaseInfo = dbResult.rows.length > 0 ? dbResult.rows[0] : null;

    // Get database schema if database exists
    let databaseSchema = null;
    if (databaseInfo) {
        // Query database for table structure
        databaseSchema = await loadDatabaseSchema(databaseInfo);
    }

    // List existing files in project
    const filesResult = await executeCommandInContainer(
        containerId,
        'find server/api -name "*.js" -o -name "*.ts" 2>/dev/null || echo "No API files found"',
    );

    const files = filesResult.result
        ? filesResult.result.split("\n").filter(function (f) {
              return f.trim() !== "" && f !== "No API files found";
          })
        : [];

    // Extract endpoints from file paths
    const endpoints = files.map(function (filePath) {
        const fileName = filePath.split("/").pop();
        const method = fileName.split(".")[1]?.toUpperCase() || "UNKNOWN";
        const path = filePath
            .replace(/^.*\/api\//, "/api/")
            .replace(/\.[^.]+\.js$/, "");
        return { method, path, file: filePath };
    });

    console.log(
        `[ContextLoader] Found ${endpoints.length} existing endpoints`,
    );
    console.log(
        `[ContextLoader] Database: ${databaseInfo ? databaseInfo.db_name : "None"}`,
    );

    return {
        databaseInfo,
        databaseSchema,
        files,
        endpoints,
    };
}

async function loadDatabaseSchema(databaseInfo) {
    // TODO: Query database to get table structure
    // For now, return null
    return null;
}
