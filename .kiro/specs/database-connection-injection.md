# Database Connection Injection Implementation Plan

## Overview
Add deterministic database connection file creation and environment variable injection for projects that require a database during initial project creation.

## Implementation Steps

### Step 1: Create Database Connection File Template
Create a new utility function that generates the `server/utils/db.js` file content with proper Postgres connection setup using environment variables.

```javascript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

export default pool;

// Test connection on module load
pool.connect((err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Connected to Postgres database');
  }
});
```

### Step 2: Modify Container Provisioning
Update the container provisioning logic to write the `server/utils/db.js` file to the container when `databaseInfo` is present.

### Step 3: Update Fly.io Secret Injection
Modify the `setDatabaseSecrets` function in `worker/services/flyioService.js` to be called during the project creation flow (it already exists but needs to be integrated into the deterministic flow). The DB_NAME should be set to `databaseInfo.dbName` (the actual database name created), not from environment variables.

### Step 4: Integrate Database File Creation into Project Creation Handler
In `worker/handlers/projectCreationExecutionHandler.js`, after database provisioning and before the agentic loop, write the database connection file to the container.

### Step 5: Commit Database Connection File
Add git commands to commit the `server/utils/db.js` file along with other deterministic files (CORS, GitHub Actions, fly.toml).

### Step 6: Call Fly.io Secret Injection in Project Creation Handler
In `worker/handlers/projectCreationExecutionHandler.js`, after creating the Fly.io app and before triggering GitHub Actions deployment, call the `setDatabaseSecrets` function (from `flyioService.js`) to inject the database environment variables (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD) into the Fly.io app. Pass `databaseInfo.dbName` as the DB_NAME value, and the cluster credentials from environment variables for the other values.
