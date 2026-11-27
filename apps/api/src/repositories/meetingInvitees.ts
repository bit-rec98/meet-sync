import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Executor } from '../db/executor.js';

export type InviteeRecord = { userId: string; displayName: string; email: string };

type InviteeRow = RowDataPacket & { user_id: string; display_name: string; email: string };

/** Throws a MySQL ER_DUP_ENTRY error if the user is already invited. */
export async function insertInvitee(
  db: Executor,
  meetingId: string,
  userId: string,
  createdAt: Date,
): Promise<void> {
  await db.execute<ResultSetHeader>(
    'INSERT INTO meeting_invitees (meeting_id, user_id, created_at) VALUES (?, ?, ?)',
    [meetingId, userId, createdAt],
  );
}

/** Returns true when an invitation was removed. */
export async function deleteInvitee(
  db: Executor,
  meetingId: string,
  userId: string,
): Promise<boolean> {
  const [result] = await db.execute<ResultSetHeader>(
    'DELETE FROM meeting_invitees WHERE meeting_id = ? AND user_id = ?',
    [meetingId, userId],
  );
  return result.affectedRows > 0;
}

export async function isInvitee(db: Executor, meetingId: string, userId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT 1 AS found FROM meeting_invitees WHERE meeting_id = ? AND user_id = ?',
    [meetingId, userId],
  );
  return rows.length > 0;
}

export async function countInvitees(db: Executor, meetingId: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM meeting_invitees WHERE meeting_id = ?',
    [meetingId],
  );
  return Number(rows[0]?.['total'] ?? 0);
}

/** Invitees in the order they were invited. */
export async function listInvitees(db: Executor, meetingId: string): Promise<InviteeRecord[]> {
  const [rows] = await db.execute<InviteeRow[]>(
    `SELECT i.user_id, u.display_name, u.email
       FROM meeting_invitees i
       JOIN users u ON u.id = i.user_id
      WHERE i.meeting_id = ?
      ORDER BY i.created_at, i.user_id`,
    [meetingId],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
  }));
}
