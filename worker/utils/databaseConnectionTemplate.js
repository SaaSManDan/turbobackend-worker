/**
 * Generate database connection file content for server/utils/db.js
 */
export function generateDatabaseConnectionFile() {
  return `import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
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
`;
}
