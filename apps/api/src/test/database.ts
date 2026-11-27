import type { Pool } from 'mysql2/promise';
import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

/** Pool for the restricted runtime account, pointed at the test database by vitest.config.ts. */
export function createTestPool(): Pool {
  const config = loadConfig();
  if (!config.database.database.endsWith('_test')) {
    throw new Error('Refusing to use a database whose name does not end in "_test"');
  }
  return createPool(config.database);
}

/** Child tables first, so foreign keys are respected. The runtime account cannot TRUNCATE. */
const TABLES_IN_DELETE_ORDER = ['meeting_invitees', 'meetings', 'refresh_tokens', 'users'];

export async function clearAllTables(pool: Pool): Promise<void> {
  for (const table of TABLES_IN_DELETE_ORDER) {
    await pool.query(`DELETE FROM \`${table}\``);
  }
}
