import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAllTables, createTestPool } from '../test/database.js';

const pool: Pool = createTestPool();

async function insertUser(email = `${randomUUID()}@example.test`): Promise<string> {
  const id = randomUUID();
  await pool.execute(
    'INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))',
    [id, email, 'Test User', 'not-a-real-hash'],
  );
  return id;
}

async function insertMeeting(hostId: string, durationMinutes = 30): Promise<string> {
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO meetings (id, host_id, title, starts_at, duration_minutes, call_type, created_at, updated_at)
     VALUES (?, ?, 'Standup', UTC_TIMESTAMP(3), ?, 'audio', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, hostId, durationMinutes],
  );
  return id;
}

describe('database schema as seen by the runtime account', () => {
  beforeEach(() => clearAllTables(pool));
  afterAll(() => pool.end());

  it('enforces unique emails', async () => {
    await insertUser('same@example.test');
    await expect(insertUser('same@example.test')).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  it('rejects meeting durations outside 5-480 minutes', async () => {
    const hostId = await insertUser();
    await expect(insertMeeting(hostId, 4)).rejects.toThrow();
    await expect(insertMeeting(hostId, 481)).rejects.toThrow();
    await expect(insertMeeting(hostId, 5)).resolves.toBeTypeOf('string');
    await expect(insertMeeting(hostId, 480)).resolves.toBeTypeOf('string');
  });

  it('rejects a meeting for a host that does not exist', async () => {
    await expect(insertMeeting(randomUUID())).rejects.toMatchObject({
      code: 'ER_NO_REFERENCED_ROW_2',
    });
  });

  it('deletes invitations together with their meeting', async () => {
    const hostId = await insertUser();
    const inviteeId = await insertUser();
    const meetingId = await insertMeeting(hostId);
    await pool.execute(
      'INSERT INTO meeting_invitees (meeting_id, user_id, created_at) VALUES (?, ?, UTC_TIMESTAMP(3))',
      [meetingId, inviteeId],
    );
    await pool.execute('DELETE FROM meetings WHERE id = ?', [meetingId]);
    const [rows] = await pool.query<RowDataPacket[]>('SELECT 1 FROM meeting_invitees');
    expect(rows).toHaveLength(0);
  });

  it('stores times in UTC and reads them back unchanged', async () => {
    const hostId = await insertUser();
    const meetingId = randomUUID();
    const startsAt = new Date('2026-12-01T15:00:00.000Z');
    await pool.execute(
      `INSERT INTO meetings (id, host_id, title, starts_at, duration_minutes, call_type, created_at, updated_at)
       VALUES (?, ?, 'UTC check', ?, 30, 'video', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [meetingId, hostId, startsAt],
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT starts_at FROM meetings WHERE id = ?',
      [meetingId],
    );
    expect((rows[0]?.['starts_at'] as Date).toISOString()).toBe('2026-12-01T15:00:00.000Z');
  });

  it('cannot change the schema (least privilege)', async () => {
    await expect(pool.query('CREATE TABLE should_not_exist (id INT)')).rejects.toMatchObject({
      code: 'ER_TABLEACCESS_DENIED_ERROR',
    });
    await expect(pool.query('DROP TABLE users')).rejects.toMatchObject({
      code: 'ER_TABLEACCESS_DENIED_ERROR',
    });
  });
});
