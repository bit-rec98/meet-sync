import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db/transaction.js';
import { insertInvitee } from '../repositories/meetingInvitees.js';
import { insertMeeting } from '../repositories/meetings.js';
import { findUserByEmail, insertUser } from '../repositories/users.js';
import { hashPassword } from '../services/passwordHasher.js';
import { SEED_PASSWORD, SEED_USERS, buildSeedMeetings, type SeedUserKey } from './seedData.js';

export type SeedReport = { users: number; meetings: number; invitations: number };
export type RemovalReport = { users: number; meetings: number };

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

/**
 * Makes the test accounts and meetings exist, as described in `seedData.ts`. Safe to repeat: accounts
 * are matched by email (their password and name are reset, their id is kept) and the seed meetings
 * are replaced by new ones with fixed ids and fresh times. Meetings made by hand are left alone.
 * Everything happens in one transaction.
 */
export async function seedDatabase(
  pool: Pool,
  options: { now?: Date; hash?: (password: string) => Promise<string> } = {},
): Promise<SeedReport> {
  const now = options.now ?? new Date();
  const hash = options.hash ?? hashPassword;

  // Hashing is slow on purpose, so it is done before the transaction holds any locks.
  const hashes = new Map<string, string>();
  for (const user of SEED_USERS) hashes.set(user.email, await hash(SEED_PASSWORD));

  const meetings = buildSeedMeetings(now);

  return withTransaction(pool, async (connection) => {
    const ids = new Map<SeedUserKey, string>();
    for (const user of SEED_USERS) {
      const passwordHash = hashes.get(user.email) as string;
      const existing = await findUserByEmail(connection, user.email);
      if (existing) {
        await connection.execute(
          'UPDATE users SET display_name = ?, password_hash = ? WHERE id = ?',
          [user.displayName, passwordHash, existing.id],
        );
        ids.set(user.key, existing.id);
      } else {
        const id = randomUUID();
        await insertUser(connection, {
          id,
          email: user.email,
          displayName: user.displayName,
          passwordHash,
          createdAt: now,
        });
        ids.set(user.key, id);
      }
    }

    // Invitations go with their meeting (ON DELETE CASCADE).
    const seedIds = meetings.map((meeting) => meeting.id);
    await connection.execute(
      `DELETE FROM meetings WHERE id IN (${placeholders(seedIds.length)})`,
      seedIds,
    );

    let invitations = 0;
    for (const meeting of meetings) {
      await insertMeeting(connection, {
        id: meeting.id,
        hostId: ids.get(meeting.host) as string,
        title: meeting.title,
        description: meeting.description,
        startsAt: meeting.startsAt,
        durationMinutes: meeting.durationMinutes,
        callType: meeting.callType,
        status: meeting.status,
        createdAt: now,
        updatedAt: now,
      });
      for (const invitee of meeting.invitees) {
        await insertInvitee(connection, meeting.id, ids.get(invitee) as string, now);
        invitations++;
      }
    }

    return { users: SEED_USERS.length, meetings: meetings.length, invitations };
  });
}

async function seedUserIds(connection: PoolConnection): Promise<string[]> {
  const emails = SEED_USERS.map((user) => user.email);
  const [rows] = await connection.execute<(RowDataPacket & { id: string })[]>(
    `SELECT id FROM users WHERE email IN (${placeholders(emails.length)})`,
    emails,
  );
  return rows.map((row) => row.id);
}

/**
 * Deletes the test accounts and everything they host (including meetings made by hand in the app,
 * because a meeting cannot outlive its host). Invitations of these accounts to other people's
 * meetings and their sessions go with them. Returns how many accounts and meetings were deleted.
 */
export async function removeSeedData(pool: Pool): Promise<RemovalReport> {
  return withTransaction(pool, async (connection) => {
    const userIds = await seedUserIds(connection);
    if (userIds.length === 0) return { users: 0, meetings: 0 };

    const [meetings] = await connection.execute<ResultSetHeader>(
      `DELETE FROM meetings WHERE host_id IN (${placeholders(userIds.length)})`,
      userIds,
    );
    const [users] = await connection.execute<ResultSetHeader>(
      `DELETE FROM users WHERE id IN (${placeholders(userIds.length)})`,
      userIds,
    );
    return { users: users.affectedRows, meetings: meetings.affectedRows };
  });
}
