import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrationDatabaseConfig } from '../config/env.js';
import { checksumOf, loadMigrationFiles, runMigrations, type MigrationFile } from './migrator.js';

// Uses an isolated history table and scratch tables so it never touches the real schema history.
const HISTORY_TABLE = 'scratch_migration_history';
const SCRATCH_TABLES = ['scratch_one', 'scratch_two'];

function file(name: string, sql: string): MigrationFile {
  return { name, sql, checksum: checksumOf(sql) };
}

const createOne = file('001_one.sql', 'CREATE TABLE scratch_one (id INT PRIMARY KEY);');
const createTwo = file('002_two.sql', 'CREATE TABLE scratch_two (id INT PRIMARY KEY);');

describe('runMigrations', () => {
  let connection: Connection;

  async function dropScratch(): Promise<void> {
    for (const table of [...SCRATCH_TABLES, HISTORY_TABLE]) {
      await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
  }

  beforeAll(async () => {
    connection = await mysql.createConnection({
      ...loadMigrationDatabaseConfig(),
      timezone: 'Z',
      multipleStatements: true,
    });
  });
  afterEach(dropScratch);
  afterAll(async () => {
    await dropScratch();
    await connection.end();
  });

  it('applies pending migrations in order and reports them', async () => {
    const applied = await runMigrations(connection, [createOne, createTwo], {
      historyTable: HISTORY_TABLE,
    });
    expect(applied).toEqual(['001_one.sql', '002_two.sql']);
    const [tables] = await connection.query<RowDataPacket[]>("SHOW TABLES LIKE 'scratch\\_%'");
    expect(tables.length).toBeGreaterThanOrEqual(2);
  });

  it('is a no-op when run again', async () => {
    await runMigrations(connection, [createOne], { historyTable: HISTORY_TABLE });
    const second = await runMigrations(connection, [createOne], { historyTable: HISTORY_TABLE });
    expect(second).toEqual([]);
  });

  it('applies only the new migration when one is added', async () => {
    await runMigrations(connection, [createOne], { historyTable: HISTORY_TABLE });
    const applied = await runMigrations(connection, [createOne, createTwo], {
      historyTable: HISTORY_TABLE,
    });
    expect(applied).toEqual(['002_two.sql']);
  });

  it('rejects a migration that changed after being applied', async () => {
    await runMigrations(connection, [createOne], { historyTable: HISTORY_TABLE });
    const tampered = file('001_one.sql', 'CREATE TABLE scratch_one (id INT, extra INT);');
    await expect(
      runMigrations(connection, [tampered], { historyTable: HISTORY_TABLE }),
    ).rejects.toThrow(/modified: 001_one.sql/);
  });

  it('rejects an applied migration that is missing from disk', async () => {
    await runMigrations(connection, [createOne, createTwo], { historyTable: HISTORY_TABLE });
    await expect(
      runMigrations(connection, [createOne], { historyTable: HISTORY_TABLE }),
    ).rejects.toThrow(/missing from disk: 002_two.sql/);
  });

  it('rejects a history table name that is not a plain identifier', async () => {
    await expect(
      runMigrations(connection, [], { historyTable: 'x`; DROP TABLE users; --' }),
    ).rejects.toThrow(/Invalid migration history table name/);
  });
});

describe('loadMigrationFiles', () => {
  it('loads the repository migrations in order with checksums', async () => {
    const files = await loadMigrationFiles(new URL('./migrations/', import.meta.url));
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]?.name).toBe('001_initial.sql');
    expect(files.map((f) => f.name)).toEqual([...files.map((f) => f.name)].sort());
    expect(files[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});
