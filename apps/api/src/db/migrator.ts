import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Connection, RowDataPacket } from 'mysql2/promise';

const MIGRATION_FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;
const LOCK_TIMEOUT_SECONDS = 30;
const HISTORY_TABLE_PATTERN = /^[a-z_]+$/;

export type MigrationFile = { name: string; sql: string; checksum: string };

export type MigrationOptions = {
  /** Table recording applied migrations. Configurable so tests can use an isolated history. */
  historyTable?: string;
};

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/** Reads `NNN_description.sql` files from a directory, in order. Other files are rejected. */
export async function loadMigrationFiles(directory: URL | string): Promise<MigrationFile[]> {
  const entries = (await readdir(directory)).sort();
  const files: MigrationFile[] = [];
  for (const name of entries) {
    if (!MIGRATION_FILE_PATTERN.test(name)) {
      throw new Error(`Unexpected file in migrations directory: ${name}`);
    }
    const sql = await readFile(new URL(name, ensureTrailingSlash(directory)), 'utf8');
    files.push({ name, sql, checksum: checksumOf(sql) });
  }
  return files;
}

function ensureTrailingSlash(directory: URL | string): URL {
  const asString = directory instanceof URL ? directory.href : `file://${directory}`;
  return new URL(asString.endsWith('/') ? asString : `${asString}/`);
}

/**
 * Applies pending migrations in order and returns the names applied by this call.
 *
 * - Holds a database-wide lock so two instances cannot migrate at the same time.
 * - Refuses to continue if an already-applied file was modified or is missing from disk.
 * - MySQL commits DDL implicitly, so a migration that fails part-way is not rolled back:
 *   keep migrations small and fix a failed one by hand before re-running.
 *
 * The connection must allow multiple statements (migration files hold several).
 */
export async function runMigrations(
  connection: Connection,
  files: MigrationFile[],
  options: MigrationOptions = {},
): Promise<string[]> {
  const historyTable = options.historyTable ?? 'schema_migrations';
  if (!HISTORY_TABLE_PATTERN.test(historyTable)) {
    throw new Error('Invalid migration history table name');
  }
  const lockName = `${historyTable}_lock`;

  const [lockRows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS acquired', [
    lockName,
    LOCK_TIMEOUT_SECONDS,
  ]);
  if (lockRows[0]?.['acquired'] !== 1) {
    throw new Error('Could not acquire the migration lock; another migration may be running');
  }

  try {
    await connection.query(
      `CREATE TABLE IF NOT EXISTS \`${historyTable}\` (
         name       VARCHAR(255) NOT NULL PRIMARY KEY,
         checksum   CHAR(64)     NOT NULL,
         applied_at DATETIME(3)  NOT NULL
       )`,
    );
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT name, checksum FROM \`${historyTable}\``,
    );
    const applied = new Map<string, string>(
      rows.map((row) => [String(row['name']), String(row['checksum'])]),
    );

    const onDisk = new Set(files.map((file) => file.name));
    for (const name of applied.keys()) {
      if (!onDisk.has(name)) {
        throw new Error(`Applied migration is missing from disk: ${name}`);
      }
    }

    const newlyApplied: string[] = [];
    for (const file of files) {
      const recordedChecksum = applied.get(file.name);
      if (recordedChecksum !== undefined) {
        if (recordedChecksum !== file.checksum) {
          throw new Error(`Applied migration was modified: ${file.name}`);
        }
        continue;
      }
      await connection.query(file.sql);
      await connection.query(
        `INSERT INTO \`${historyTable}\` (name, checksum, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))`,
        [file.name, file.checksum],
      );
      newlyApplied.push(file.name);
    }
    return newlyApplied;
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
  }
}
