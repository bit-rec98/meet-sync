import mysql from 'mysql2/promise';
import type { DatabaseConfig } from '../config/env.js';

const CONNECTION_LIMIT = 10;

/**
 * Connection pool for the running API. Statements are parameterized by callers; multiple
 * statements per query are disabled (mysql2 default) to limit the impact of any injection bug.
 */
export function createPool(config: DatabaseConfig): mysql.Pool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    charset: 'utf8mb4',
    timezone: 'Z', // all DATETIME values are UTC
    connectionLimit: CONNECTION_LIMIT,
  });
}

/** Throws if the database cannot be reached with the configured credentials. */
export async function assertDatabaseReachable(pool: mysql.Pool): Promise<void> {
  await pool.query('SELECT 1');
}
