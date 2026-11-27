import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Executor } from '../db/executor.js';

export type RefreshTokenRecord = {
  id: string;
  userId: string;
  /** All tokens issued from one login share a family, so a whole session can be revoked at once. */
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

type RefreshTokenRow = RowDataPacket & {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
};

const COLUMNS = 'id, user_id, family_id, token_hash, expires_at, revoked_at, created_at';

const toRecord = (row: RefreshTokenRow): RefreshTokenRecord => ({
  id: row.id,
  userId: row.user_id,
  familyId: row.family_id,
  tokenHash: row.token_hash,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
  createdAt: row.created_at,
});

export async function insertRefreshToken(db: Executor, token: RefreshTokenRecord): Promise<void> {
  await db.execute<ResultSetHeader>(
    `INSERT INTO refresh_tokens (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      token.id,
      token.userId,
      token.familyId,
      token.tokenHash,
      token.expiresAt,
      token.revokedAt,
      token.createdAt,
    ],
  );
}

export async function findRefreshTokenByHash(
  db: Executor,
  tokenHash: string,
): Promise<RefreshTokenRecord | null> {
  const [rows] = await db.execute<RefreshTokenRow[]>(
    `SELECT ${COLUMNS} FROM refresh_tokens WHERE token_hash = ?`,
    [tokenHash],
  );
  const row = rows[0];
  return row ? toRecord(row) : null;
}

/**
 * Same as {@link findRefreshTokenByHash} but locks the row until the transaction ends, so two
 * simultaneous refreshes of the same token cannot both succeed. Use inside `withTransaction`.
 */
export async function findRefreshTokenByHashForUpdate(
  db: Executor,
  tokenHash: string,
): Promise<RefreshTokenRecord | null> {
  const [rows] = await db.execute<RefreshTokenRow[]>(
    `SELECT ${COLUMNS} FROM refresh_tokens WHERE token_hash = ? FOR UPDATE`,
    [tokenHash],
  );
  const row = rows[0];
  return row ? toRecord(row) : null;
}

export async function revokeRefreshToken(db: Executor, id: string, at: Date): Promise<void> {
  await db.execute<ResultSetHeader>(
    'UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    [at, id],
  );
}

/** Revokes every still-active token of a session (login chain). Already revoked rows keep their date. */
export async function revokeRefreshTokenFamily(
  db: Executor,
  familyId: string,
  at: Date,
): Promise<void> {
  await db.execute<ResultSetHeader>(
    'UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL',
    [at, familyId],
  );
}
