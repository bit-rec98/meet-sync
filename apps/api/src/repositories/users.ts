import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Executor } from '../db/executor.js';

export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: Date;
};

type UserRow = RowDataPacket & {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: Date;
};

const toUserRecord = (row: UserRow): UserRecord => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  passwordHash: row.password_hash,
  createdAt: row.created_at,
});

/** Throws a MySQL ER_DUP_ENTRY error if the email is already registered. */
export async function insertUser(db: Executor, user: UserRecord): Promise<void> {
  await db.execute<ResultSetHeader>(
    'INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    [user.id, user.email, user.displayName, user.passwordHash, user.createdAt],
  );
}

/** `email` must already be normalized (trimmed, lower-case). */
export async function findUserByEmail(db: Executor, email: string): Promise<UserRecord | null> {
  const [rows] = await db.execute<UserRow[]>(
    'SELECT id, email, display_name, password_hash, created_at FROM users WHERE email = ?',
    [email],
  );
  const row = rows[0];
  return row ? toUserRecord(row) : null;
}

export async function findUserById(db: Executor, id: string): Promise<UserRecord | null> {
  const [rows] = await db.execute<UserRow[]>(
    'SELECT id, email, display_name, password_hash, created_at FROM users WHERE id = ?',
    [id],
  );
  const row = rows[0];
  return row ? toUserRecord(row) : null;
}
