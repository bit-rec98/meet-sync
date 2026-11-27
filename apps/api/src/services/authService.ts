import { randomUUID } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import type { Executor } from '../db/executor.js';
import { isDuplicateEntryError } from '../db/mysqlErrors.js';
import { withTransaction } from '../db/transaction.js';
import { DomainError } from '../errors.js';
import {
  findRefreshTokenByHash,
  findRefreshTokenByHashForUpdate,
  insertRefreshToken,
  revokeRefreshToken,
  revokeRefreshTokenFamily,
} from '../repositories/refreshTokens.js';
import {
  findUserByEmail,
  findUserById,
  insertUser,
  type UserRecord,
} from '../repositories/users.js';
import { hashPassword, verifyPassword } from './passwordHasher.js';
import {
  REFRESH_TOKEN_TTL_DAYS,
  generateRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
  type AccessTokenService,
} from './tokens.js';

export type PublicUser = { id: string; email: string; displayName: string };

export type RefreshedSession = {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};

export type Session = RefreshedSession & { user: PublicUser };

/** Inputs are already validated and normalized (e.g. lower-case email) by the HTTP layer. */
export type AuthService = {
  register(input: { email: string; displayName: string; password: string }): Promise<Session>;
  login(input: { email: string; password: string }): Promise<Session>;
  /** Rotates the refresh token. Presenting an already-used token revokes the whole session. */
  refresh(refreshToken: string): Promise<RefreshedSession>;
  /** Idempotent: unknown or already-revoked tokens are ignored. */
  logout(refreshToken: string): Promise<void>;
  /** Returns the user id of a valid access token. */
  authenticate(accessToken: string): Promise<string>;
  getUser(userId: string): Promise<PublicUser>;
};

export type AuthServiceDependencies = {
  pool: Pool;
  accessTokens: AccessTokenService;
  now: () => Date;
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const toPublicUser = (user: UserRecord): PublicUser => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
});

type RotationOutcome =
  | { kind: 'rotated'; userId: string; refreshToken: string; refreshTokenExpiresAt: Date }
  | { kind: 'rejected' };

export function createAuthService({
  pool,
  accessTokens,
  now,
}: AuthServiceDependencies): AuthService {
  // Used to spend the same time verifying a password when the email is unknown, so response time
  // does not reveal which emails have accounts.
  let dummyHash: Promise<string> | undefined;
  const getDummyHash = (): Promise<string> => (dummyHash ??= hashPassword('not-a-real-password'));

  async function issueRefreshToken(
    db: Executor,
    userId: string,
    familyId: string,
    issuedAt: Date,
  ): Promise<{ refreshToken: string; refreshTokenExpiresAt: Date }> {
    const refreshToken = generateRefreshToken();
    const refreshTokenExpiresAt = new Date(
      issuedAt.getTime() + REFRESH_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY,
    );
    await insertRefreshToken(db, {
      id: randomUUID(),
      userId,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiresAt,
      revokedAt: null,
      createdAt: issuedAt,
    });
    return { refreshToken, refreshTokenExpiresAt };
  }

  async function startSession(user: UserRecord): Promise<Session> {
    const issuedAt = now();
    const refresh = await issueRefreshToken(pool, user.id, randomUUID(), issuedAt);
    const accessToken = await accessTokens.sign(user.id, issuedAt);
    return { user: toPublicUser(user), accessToken, ...refresh };
  }

  return {
    async register({ email, displayName, password }) {
      const user: UserRecord = {
        id: randomUUID(),
        email,
        displayName,
        passwordHash: await hashPassword(password),
        createdAt: now(),
      };
      try {
        await insertUser(pool, user);
      } catch (error) {
        if (isDuplicateEntryError(error)) throw new DomainError('email_taken');
        throw error;
      }
      return startSession(user);
    },

    async login({ email, password }) {
      const user = await findUserByEmail(pool, email);
      if (!user) {
        await verifyPassword(password, await getDummyHash());
        throw new DomainError('invalid_credentials');
      }
      if (!(await verifyPassword(password, user.passwordHash))) {
        throw new DomainError('invalid_credentials');
      }
      return startSession(user);
    },

    async refresh(refreshToken) {
      if (!isWellFormedRefreshToken(refreshToken)) throw new DomainError('unauthorized');

      // The outcome is returned (not thrown) from the transaction so that revoking a reused
      // token's family is committed instead of rolled back.
      const outcome = await withTransaction(pool, async (connection): Promise<RotationOutcome> => {
        const current = await findRefreshTokenByHashForUpdate(
          connection,
          hashRefreshToken(refreshToken),
        );
        if (!current) return { kind: 'rejected' };

        const at = now();
        if (current.revokedAt !== null) {
          // A rotated or logged-out token came back: treat the session as stolen.
          await revokeRefreshTokenFamily(connection, current.familyId, at);
          return { kind: 'rejected' };
        }
        if (current.expiresAt <= at) return { kind: 'rejected' };

        await revokeRefreshToken(connection, current.id, at);
        const next = await issueRefreshToken(connection, current.userId, current.familyId, at);
        return { kind: 'rotated', userId: current.userId, ...next };
      });

      if (outcome.kind === 'rejected') throw new DomainError('unauthorized');
      const accessToken = await accessTokens.sign(outcome.userId, now());
      return {
        accessToken,
        refreshToken: outcome.refreshToken,
        refreshTokenExpiresAt: outcome.refreshTokenExpiresAt,
      };
    },

    async logout(refreshToken) {
      if (!isWellFormedRefreshToken(refreshToken)) return;
      const current = await findRefreshTokenByHash(pool, hashRefreshToken(refreshToken));
      if (current) await revokeRefreshTokenFamily(pool, current.familyId, now());
    },

    async authenticate(accessToken) {
      try {
        return await accessTokens.verify(accessToken, now());
      } catch {
        throw new DomainError('unauthorized');
      }
    },

    async getUser(userId) {
      const user = await findUserById(pool, userId);
      if (!user) throw new DomainError('unauthorized');
      return toPublicUser(user);
    },
  };
}
