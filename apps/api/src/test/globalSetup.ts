import mysql from 'mysql2/promise';
import { loadMigrationDatabaseConfig } from '../config/env.js';
import { loadMigrationFiles, runMigrations } from '../db/migrator.js';

/** Brings the test database schema up to date once before the test run. */
export default async function setup(): Promise<void> {
  const config = loadMigrationDatabaseConfig();
  if (!config.database.endsWith('_test')) {
    throw new Error('Refusing to migrate a database whose name does not end in "_test"');
  }
  const connection = await mysql.createConnection({
    ...config,
    timezone: 'Z',
    multipleStatements: true,
  });
  try {
    const files = await loadMigrationFiles(new URL('../db/migrations/', import.meta.url));
    await runMigrations(connection, files);
  } finally {
    await connection.end();
  }
}
