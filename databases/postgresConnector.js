import { Pool } from 'pg';
const requiredEnvVars = [
    'PG_DB_HOST',
    'PG_DB_PORT',
    'PG_DB_USER',
    'PG_DB_PASS',
    'PG_DB_NAME',
];

const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
    throw new Error(
        `Missing Postgres environment variables: ${missingEnvVars.join(', ')}`,
    );
}

const pool = new Pool({
    host: process.env.PG_DB_HOST,
    port: Number(process.env.PG_DB_PORT),
    user: process.env.PG_DB_USER,
    password: process.env.PG_DB_PASS,
    database: process.env.PG_DB_NAME,
    ssl: process.env.NODE_ENV === 'production' && { rejectUnauthorized: false },
});

async function testPostgresConnection() {
    try {
        const client = await pool.connect();
        const result = await client.query(
            "SELECT tablename FROM pg_tables WHERE schemaname = '" + process.env.PG_DB_SCHEMA + "';"
        );
        client.release();
        console.log("PostgresDB connection successful.");
        result.rows.forEach(row => {
            console.log(`- ${row.tablename}`);
        });
        return true;
    } catch (error) {
        console.error('Postgres connection failed:', error);
        return false;
    }
}

testPostgresConnection();

export default pool;
