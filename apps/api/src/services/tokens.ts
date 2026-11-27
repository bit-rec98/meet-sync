import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 7;

const ISSUER = 'meet-sync';
const AUDIENCE = 'meet-sync-web';
const ALGORITHM = 'HS256';
const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url encoded

export type AccessTokenService = {
  sign(userId: string, now: Date): Promise<string>;
  /** Returns the user id. Throws if the token is invalid, expired, or not meant for this service. */
  verify(token: string, now: Date): Promise<string>;
};

/** Access tokens are short-lived JWTs. Only HS256 is accepted; issuer and audience are checked. */
export function createAccessTokenService(secret: string): AccessTokenService {
  const key = new TextEncoder().encode(secret);
  return {
    async sign(userId, now) {
      const issuedAt = Math.floor(now.getTime() / 1000);
      return new SignJWT({})
        .setProtectedHeader({ alg: ALGORITHM })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
        .sign(key);
    },
    async verify(token, now) {
      const { payload } = await jwtVerify(token, key, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: now,
      });
      if (typeof payload.sub !== 'string' || payload.sub === '') {
        throw new Error('Access token has no subject');
      }
      return payload.sub;
    },
  };
}

/** A new opaque refresh token: 32 random bytes, base64url encoded. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Cheap shape check, so obviously invalid cookie values never reach the database. */
export function isWellFormedRefreshToken(token: string): boolean {
  return REFRESH_TOKEN_PATTERN.test(token);
}

/** Only this hash is stored; the token itself never reaches the database. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
