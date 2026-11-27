import { randomUUID } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { insertUser, type UserRecord } from '../repositories/users.js';
import { createAccessTokenService } from '../services/tokens.js';

/**
 * Inserts a user directly, skipping password hashing, for tests that need many users quickly.
 * The stored hash is not a valid Argon2 hash, so these users cannot log in.
 */
export async function insertTestUser(
  pool: Pool,
  overrides: { email?: string; displayName?: string } = {},
): Promise<UserRecord> {
  const user: UserRecord = {
    id: randomUUID(),
    email: overrides.email ?? `${randomUUID()}@example.test`,
    displayName: overrides.displayName ?? 'Test User',
    passwordHash: 'not-a-real-hash',
    createdAt: new Date(),
  };
  await insertUser(pool, user);
  return user;
}

/** A valid access token for the user, signed with the given secret, as the API would issue it. */
export function accessTokenFor(userId: string, secret: string, now: Date): Promise<string> {
  return createAccessTokenService(secret).sign(userId, now);
}
