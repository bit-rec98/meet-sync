import mysql from 'mysql2/promise';
import { loadMigrationDatabaseConfig } from '../config/env.js';
import { loadMigrationFiles, runMigrations } from './migrator.js';

/** Command-line entry point: `npm run migrate`. Uses the migration account, not the runtime one. */
async function main(): Promise<void> {
  const config = loadMigrationDatabaseConfig();
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: true, // migration files are trusted repository content, never user input
  });
  try {
    const files = await loadMigrationFiles(new URL('./migrations/', import.meta.url));
    const applied = await runMigrations(connection, files);
    console.info(
      applied.length === 0 ? 'Database is up to date.' : `Applied: ${applied.join(', ')}`,
    );
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
});
