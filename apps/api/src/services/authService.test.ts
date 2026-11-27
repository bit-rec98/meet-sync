import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { clearAllTables, createTestPool } from '../test/database.js';
import { createAuthService, type AuthService, type Session } from './authService.js';
import { createAccessTokenService, hashRefreshToken } from './tokens.js';

const START = new Date('2026-12-01T12:00:00.000Z');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD = 'correct horse battery staple';

const pool: Pool = createTestPool();
const clock = { current: START };
const accessTokens = createAccessTokenService('s'.repeat(40));
const service: AuthService = createAuthService({ pool, accessTokens, now: () => clock.current });

const advance = (milliseconds: number): void => {
  clock.current = new Date(clock.current.getTime() + milliseconds);
};

function register(email = 'ana@example.test'): Promise<Session> {
  return service.register({ email, displayName: 'Ana', password: PASSWORD });
}

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code });
}

async function rows(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [result] = await pool.query<RowDataPacket[]>(sql, params);
  return result;
}

describe('authService', () => {
  beforeEach(async () => {
    clock.current = START;
    await clearAllTables(pool);
  });
  afterAll(() => pool.end());

  describe('register', () => {
    it('creates the account and a session without exposing the password hash', async () => {
      const session = await register();
      expect(session.user).toEqual({
        id: expect.any(String),
        email: 'ana@example.test',
        displayName: 'Ana',
      });
      expect(JSON.stringify(session)).not.toContain('argon2');
      expect(await accessTokens.verify(session.accessToken, clock.current)).toBe(session.user.id);
    });

    it('stores an Argon2id hash, never the password', async () => {
      await register();
      const [user] = await rows('SELECT password_hash FROM users');
      expect(user?.['password_hash']).toMatch(/^\$argon2id\$/);
      expect(user?.['password_hash']).not.toContain(PASSWORD);
    });

    it('stores only the hash of the refresh token, expiring in 7 days', async () => {
      const session = await register();
      const [token] = await rows('SELECT token_hash, expires_at FROM refresh_tokens');
      expect(token?.['token_hash']).toBe(hashRefreshToken(session.refreshToken));
      expect(token?.['token_hash']).not.toBe(session.refreshToken);
      expect((token?.['expires_at'] as Date).getTime()).toBe(START.getTime() + SEVEN_DAYS_MS);
      expect(session.refreshTokenExpiresAt.getTime()).toBe(START.getTime() + SEVEN_DAYS_MS);
    });

    it('rejects an email that is already registered', async () => {
      await register();
      await expectDomainError(register(), 'email_taken');
    });

    it('lets exactly one of two simultaneous registrations for the same email succeed', async () => {
      const results = await Promise.allSettled([
        register('race@example.test'),
        register('race@example.test'),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((result) => result.status === 'rejected');
      expect(failure?.status === 'rejected' && failure.reason).toMatchObject({
        code: 'email_taken',
      });
    });
  });

  describe('login', () => {
    it('returns a session for the right credentials', async () => {
      const registered = await register();
      const session = await service.login({ email: 'ana@example.test', password: PASSWORD });
      expect(session.user.id).toBe(registered.user.id);
      expect(session.refreshToken).not.toBe(registered.refreshToken);
    });

    it('gives the same error for a wrong password and an unknown email', async () => {
      await register();
      await expectDomainError(
        service.login({ email: 'ana@example.test', password: 'wrong password here' }),
        'invalid_credentials',
      );
      await expectDomainError(
        service.login({ email: 'nobody@example.test', password: PASSWORD }),
        'invalid_credentials',
      );
    });

    it('starts a separate session for each login', async () => {
      await register();
      await service.login({ email: 'ana@example.test', password: PASSWORD });
      const families = await rows('SELECT DISTINCT family_id FROM refresh_tokens');
      expect(families).toHaveLength(2);
    });
  });

  describe('refresh', () => {
    it('rotates the token: the old one is revoked and the new one is in the same session', async () => {
      const session = await register();
      advance(60_000);
      const refreshed = await service.refresh(session.refreshToken);

      expect(refreshed.refreshToken).not.toBe(session.refreshToken);
      expect(await accessTokens.verify(refreshed.accessToken, clock.current)).toBe(session.user.id);

      const stored = await rows(
        'SELECT token_hash, family_id, revoked_at FROM refresh_tokens ORDER BY created_at',
      );
      expect(stored).toHaveLength(2);
      expect(stored[0]?.['family_id']).toBe(stored[1]?.['family_id']);
      expect(stored[0]?.['revoked_at']).toBeInstanceOf(Date);
      expect(stored[1]?.['revoked_at']).toBeNull();
    });

    it('keeps working along the chain of rotated tokens', async () => {
      let token = (await register()).refreshToken;
      for (let step = 0; step < 3; step++) {
        advance(60_000);
        token = (await service.refresh(token)).refreshToken;
      }
      expect(token).toHaveLength(43);
    });

    it('treats reuse of a rotated token as theft and revokes the whole session', async () => {
      const first = await register();
      const second = await service.refresh(first.refreshToken);

      await expectDomainError(service.refresh(first.refreshToken), 'unauthorized');
      // The legitimate newest token of that session is revoked too.
      await expectDomainError(service.refresh(second.refreshToken), 'unauthorized');
      const active = await rows('SELECT id FROM refresh_tokens WHERE revoked_at IS NULL');
      expect(active).toHaveLength(0);
    });

    it('does not affect the user’s other sessions when one session is revoked', async () => {
      const laptop = await register();
      const phone = await service.login({ email: 'ana@example.test', password: PASSWORD });
      await service.refresh(laptop.refreshToken);
      await expectDomainError(service.refresh(laptop.refreshToken), 'unauthorized');

      await expect(service.refresh(phone.refreshToken)).resolves.toBeDefined();
    });

    it('rejects an expired token but accepts it one second earlier', async () => {
      const session = await register();
      advance(SEVEN_DAYS_MS - 1000);
      const stillValid = await service.refresh(session.refreshToken);

      advance(SEVEN_DAYS_MS);
      await expectDomainError(service.refresh(stillValid.refreshToken), 'unauthorized');
    });

    it('rejects a token exactly at its expiry time', async () => {
      const session = await register();
      advance(SEVEN_DAYS_MS);
      await expectDomainError(service.refresh(session.refreshToken), 'unauthorized');
    });

    it('rejects unknown and malformed tokens', async () => {
      await register();
      await expectDomainError(service.refresh('a'.repeat(43)), 'unauthorized');
      await expectDomainError(service.refresh(''), 'unauthorized');
      await expectDomainError(service.refresh("' OR 1=1 --"), 'unauthorized');
    });

    it('lets exactly one of two simultaneous refreshes of the same token succeed', async () => {
      const session = await register();
      const results = await Promise.allSettled([
        service.refresh(session.refreshToken),
        service.refresh(session.refreshToken),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((result) => result.status === 'rejected');
      expect(failure?.status === 'rejected' && failure.reason).toMatchObject({
        code: 'unauthorized',
      });
    });
  });

  describe('logout', () => {
    it('revokes the session so its refresh token no longer works', async () => {
      const session = await register();
      await service.logout(session.refreshToken);
      await expectDomainError(service.refresh(session.refreshToken), 'unauthorized');
    });

    it('revokes tokens rotated earlier in the same session', async () => {
      const first = await register();
      const second = await service.refresh(first.refreshToken);
      await service.logout(second.refreshToken);
      const active = await rows('SELECT id FROM refresh_tokens WHERE revoked_at IS NULL');
      expect(active).toHaveLength(0);
    });

    it('is idempotent and ignores unknown or malformed tokens', async () => {
      const session = await register();
      await service.logout(session.refreshToken);
      await expect(service.logout(session.refreshToken)).resolves.toBeUndefined();
      await expect(service.logout('a'.repeat(43))).resolves.toBeUndefined();
      await expect(service.logout('not a token')).resolves.toBeUndefined();
    });

    it('does not end the user’s other sessions', async () => {
      const laptop = await register();
      const phone = await service.login({ email: 'ana@example.test', password: PASSWORD });
      await service.logout(laptop.refreshToken);
      await expect(service.refresh(phone.refreshToken)).resolves.toBeDefined();
    });
  });

  describe('authenticate and getUser', () => {
    it('accepts a fresh access token and rejects it after 15 minutes', async () => {
      const session = await register();
      expect(await service.authenticate(session.accessToken)).toBe(session.user.id);
      advance(15 * 60 * 1000);
      await expectDomainError(service.authenticate(session.accessToken), 'unauthorized');
    });

    it('rejects garbage tokens', async () => {
      await expectDomainError(service.authenticate('not.a.jwt'), 'unauthorized');
    });

    it('returns the public profile and fails for an unknown user', async () => {
      const session = await register();
      expect(await service.getUser(session.user.id)).toEqual(session.user);
      await expectDomainError(
        service.getUser('00000000-0000-4000-8000-000000000000'),
        'unauthorized',
      );
    });
  });
});
