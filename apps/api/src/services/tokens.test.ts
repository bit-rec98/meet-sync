import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  createAccessTokenService,
  generateRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
} from './tokens.js';

const SECRET = 'a'.repeat(40);
const NOW = new Date('2026-12-01T12:00:00.000Z');
const service = createAccessTokenService(SECRET);

const secondsLater = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);

function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('access tokens', () => {
  it('round-trips the user id', async () => {
    const token = await service.sign('user-1', NOW);
    expect(await service.verify(token, NOW)).toBe('user-1');
  });

  it('is valid until just before 15 minutes and expired at 15 minutes', async () => {
    const token = await service.sign('user-1', NOW);
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(await service.verify(token, secondsLater(899))).toBe('user-1');
    await expect(service.verify(token, secondsLater(900))).rejects.toThrow();
  });

  it('rejects a token signed with a different key', async () => {
    const other = createAccessTokenService('b'.repeat(40));
    await expect(service.verify(await other.sign('user-1', NOW), NOW)).rejects.toThrow();
  });

  it('rejects a tampered payload', async () => {
    const [header, , signature] = (await service.sign('user-1', NOW)).split('.');
    const forgedPayload = encodeJson({
      sub: 'admin',
      iss: 'meet-sync',
      aud: 'meet-sync-web',
      exp: 9999999999,
    });
    await expect(service.verify(`${header}.${forgedPayload}.${signature}`, NOW)).rejects.toThrow();
  });

  it('rejects unsigned tokens (alg none)', async () => {
    const unsigned = `${encodeJson({ alg: 'none', typ: 'JWT' })}.${encodeJson({
      sub: 'user-1',
      iss: 'meet-sync',
      aud: 'meet-sync-web',
      exp: 9999999999,
    })}.`;
    await expect(service.verify(unsigned, NOW)).rejects.toThrow();
  });

  it('rejects tokens with the wrong audience or issuer', async () => {
    const key = new TextEncoder().encode(SECRET);
    const base = () =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-1')
        .setExpirationTime(9999999999);
    const wrongAudience = await base().setIssuer('meet-sync').setAudience('someone-else').sign(key);
    const wrongIssuer = await base()
      .setIssuer('someone-else')
      .setAudience('meet-sync-web')
      .sign(key);
    await expect(service.verify(wrongAudience, NOW)).rejects.toThrow();
    await expect(service.verify(wrongIssuer, NOW)).rejects.toThrow();
  });

  it('rejects a token signed with a different HMAC algorithm', async () => {
    const key = new TextEncoder().encode(SECRET);
    const hs512 = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('user-1')
      .setIssuer('meet-sync')
      .setAudience('meet-sync-web')
      .setExpirationTime(9999999999)
      .sign(key);
    await expect(service.verify(hs512, NOW)).rejects.toThrow();
  });

  it('rejects a token without a subject', async () => {
    const key = new TextEncoder().encode(SECRET);
    const noSubject = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('meet-sync')
      .setAudience('meet-sync-web')
      .setExpirationTime(9999999999)
      .sign(key);
    await expect(service.verify(noSubject, NOW)).rejects.toThrow();
  });

  it('rejects garbage', async () => {
    for (const garbage of ['', 'abc', 'a.b.c', 'Bearer x']) {
      await expect(service.verify(garbage, NOW)).rejects.toThrow();
    }
  });
});

describe('refresh tokens', () => {
  it('generates distinct, well-formed tokens', () => {
    const first = generateRefreshToken();
    const second = generateRefreshToken();
    expect(first).not.toBe(second);
    expect(isWellFormedRefreshToken(first)).toBe(true);
  });

  it('rejects malformed tokens', () => {
    for (const bad of ['', 'short', `${'a'.repeat(43)}!`, 'a'.repeat(44), `${'a'.repeat(42)} `]) {
      expect(isWellFormedRefreshToken(bad)).toBe(false);
    }
  });

  it('hashes to a 64-character hex SHA-256 that differs from the token', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashRefreshToken(token)).toBe(hash);
  });
});
