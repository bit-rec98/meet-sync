import request, { type Response } from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test/app.js';
import { clearAllTables } from '../../test/database.js';
import type { RateLimitSettings } from '../middleware/rateLimits.js';

const PASSWORD = 'correct horse battery staple';
const EMAIL = 'ana@example.test';
const COOKIE_PREFIX = 'refresh_token=';
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const url = (path: string): string => `/api/v1/auth${path}`;

function setCookies(response: Response): string[] {
  const raw: unknown = response.headers['set-cookie'];
  return Array.isArray(raw) ? raw.map(String) : [];
}

/** The full Set-Cookie header of the refresh cookie. */
function refreshCookieHeader(response: Response): string {
  const header = setCookies(response).find((cookie) => cookie.startsWith(COOKIE_PREFIX));
  if (header === undefined) throw new Error('Response did not set the refresh cookie');
  return header;
}

/** The token inside the refresh cookie. */
function refreshTokenOf(response: Response): string {
  const header = refreshCookieHeader(response);
  return header.slice(COOKIE_PREFIX.length, header.indexOf(';'));
}

const cookieFor = (token: string): string => `${COOKIE_PREFIX}${token}`;

type Account = { accessToken: string; refreshToken: string };

async function registerAccount(context: TestContext, email = EMAIL): Promise<Account> {
  const response = await request(context.app)
    .post(url('/register'))
    .send({ email, displayName: 'Ana', password: PASSWORD });
  expect(response.status).toBe(201);
  return { accessToken: response.body.accessToken, refreshToken: refreshTokenOf(response) };
}

async function countRows(context: TestContext, table: 'users' | 'refresh_tokens'): Promise<number> {
  const [rows] = await context.pool.query<import('mysql2/promise').RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM \`${table}\``,
  );
  return Number(rows[0]?.['total']);
}

const context = createTestContext();
const { app } = context;
const [allowedOrigin = 'http://localhost:5173'] = context.config.webOrigins;

beforeEach(() => clearAllTables(context.pool));
afterAll(() => context.close());

describe('POST /auth/register', () => {
  it('creates the account, returns the user and an access token, and sets the refresh cookie', async () => {
    const response = await request(app)
      .post(url('/register'))
      .send({ email: EMAIL, displayName: 'Ana', password: PASSWORD });

    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(['accessToken', 'user']);
    expect(response.body.user).toEqual({
      id: expect.any(String),
      email: EMAIL,
      displayName: 'Ana',
    });
    expect(response.body.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('sets the refresh cookie with the documented attributes', async () => {
    const response = await request(app)
      .post(url('/register'))
      .send({ email: EMAIL, displayName: 'Ana', password: PASSWORD });

    const header = refreshCookieHeader(response);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/api/v1/auth');
    expect(header).toContain('Max-Age=604800'); // 7 days
    expect(header).not.toContain('Secure'); // only outside production
    expect(refreshTokenOf(response)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never returns the password, its hash, or the refresh token in the body', async () => {
    const response = await request(app)
      .post(url('/register'))
      .send({ email: EMAIL, displayName: 'Ana', password: PASSWORD });
    const body = JSON.stringify(response.body);
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toContain('argon2');
    expect(body).not.toContain(refreshTokenOf(response));
  });

  it('normalizes the email, so login works with any letter case', async () => {
    await request(app)
      .post(url('/register'))
      .send({ email: '  Ana@Example.TEST ', displayName: 'Ana', password: PASSWORD })
      .expect(201);
    const login = await request(app)
      .post(url('/login'))
      .send({ email: 'ANA@example.test', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe(EMAIL);
  });

  it('answers 409 for an email already registered, in any letter case', async () => {
    await registerAccount(context);
    const response = await request(app)
      .post(url('/register'))
      .send({ email: 'ANA@EXAMPLE.TEST', displayName: 'Other', password: PASSWORD });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('email_taken');
    expect(await countRows(context, 'users')).toBe(1);
  });

  it('answers 400 with field-level details that never echo submitted values', async () => {
    const response = await request(app)
      .post(url('/register'))
      .send({ email: 'not-an-email', displayName: '', password: 'short-pw' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        { path: 'email', code: 'invalid_format' },
        { path: 'displayName', code: 'too_small' },
        { path: 'password', code: 'too_small' },
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain('short-pw');
    expect(await countRows(context, 'users')).toBe(0);
  });

  it('rejects unknown fields instead of ignoring them', async () => {
    const response = await request(app)
      .post(url('/register'))
      .send({ email: EMAIL, displayName: 'Ana', password: PASSWORD, role: 'admin' });
    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([{ path: 'role', code: 'unrecognized_key' }]);
    expect(await countRows(context, 'users')).toBe(0);
  });

  it('answers 400 for a missing body and for malformed JSON', async () => {
    expect((await request(app).post(url('/register'))).status).toBe(400);
    const malformed = await request(app)
      .post(url('/register'))
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('validation_error');
  });

  it('answers 415 for bodies that are not JSON (including HTML-form encodings)', async () => {
    const form = await request(app)
      .post(url('/register'))
      .type('form')
      .send({ email: EMAIL, displayName: 'Ana', password: PASSWORD });
    expect(form.status).toBe(415);
    expect(form.body.error.code).toBe('unsupported_media_type');

    const text = await request(app).post(url('/register')).type('text/plain').send('hello');
    expect(text.status).toBe(415);
    expect(await countRows(context, 'users')).toBe(0);
  });

  it('answers 413 for a body over 100 kB', async () => {
    const response = await request(app)
      .post(url('/register'))
      .send({ email: EMAIL, displayName: 'Ana', password: 'x'.repeat(101 * 1024) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('payload_too_large');
  });
});

describe('POST /auth/login', () => {
  it('returns the user, an access token, and a new refresh cookie', async () => {
    await registerAccount(context);
    const response = await request(app)
      .post(url('/login'))
      .send({ email: EMAIL, password: PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(EMAIL);
    expect(response.body.accessToken).toBeTypeOf('string');
    expect(refreshCookieHeader(response)).toContain('HttpOnly');
  });

  it('answers identically for a wrong password and an unknown email', async () => {
    await registerAccount(context);
    const wrongPassword = await request(app)
      .post(url('/login'))
      .send({ email: EMAIL, password: 'not the password' });
    const unknownEmail = await request(app)
      .post(url('/login'))
      .send({ email: 'nobody@example.test', password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(wrongPassword.body.error.code).toBe('invalid_credentials');
    expect(setCookies(wrongPassword)).toEqual([]);
    expect(setCookies(unknownEmail)).toEqual([]);
  });

  it('accepts a short password in the request (policy applies at registration) but rejects an oversized one', async () => {
    expect(
      (await request(app).post(url('/login')).send({ email: EMAIL, password: 'x' })).status,
    ).toBe(401);
    const oversized = await request(app)
      .post(url('/login'))
      .send({ email: EMAIL, password: 'x'.repeat(129) });
    expect(oversized.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('returns the current user for a valid access token', async () => {
    const { accessToken } = await registerAccount(context);
    const response = await request(app)
      .get(url('/me'))
      .set('Authorization', `Bearer ${accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: { id: expect.any(String), email: EMAIL, displayName: 'Ana' },
    });
  });

  it('answers 401 with the same body for every kind of bad credential', async () => {
    const { accessToken } = await registerAccount(context);
    const attempts = [
      undefined,
      'Bearer',
      'Bearer ',
      'Basic dXNlcjpwYXNz',
      'Bearer not.a.jwt',
      `Bearer ${accessToken}x`,
      `bearer ${accessToken}`,
    ];
    const bodies = [];
    for (const header of attempts) {
      const req = request(app).get(url('/me'));
      const response = await (header === undefined ? req : req.set('Authorization', header));
      expect(response.status, `Authorization: ${header}`).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
      bodies.push(response.body);
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
  });

  it('rejects an access token once 15 minutes have passed', async () => {
    const { accessToken } = await registerAccount(context);
    context.clock.current = new Date(context.clock.current.getTime() + FIFTEEN_MINUTES_MS - 1000);
    await request(app).get(url('/me')).set('Authorization', `Bearer ${accessToken}`).expect(200);
    context.clock.current = new Date(context.clock.current.getTime() + 1000);
    await request(app).get(url('/me')).set('Authorization', `Bearer ${accessToken}`).expect(401);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and returns a working access token', async () => {
    const { refreshToken } = await registerAccount(context);
    const response = await request(app)
      .post(url('/refresh'))
      .set('Cookie', cookieFor(refreshToken));

    expect(response.status).toBe(200);
    expect(Object.keys(response.body)).toEqual(['accessToken']);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(refreshTokenOf(response)).not.toBe(refreshToken);
    await request(app)
      .get(url('/me'))
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
  });

  it('treats reuse of a rotated token as theft: 401, cookie cleared, whole session revoked', async () => {
    const { refreshToken: original } = await registerAccount(context);
    const rotated = await request(app)
      .post(url('/refresh'))
      .set('Cookie', cookieFor(original))
      .expect(200);
    const newest = refreshTokenOf(rotated);

    const reuse = await request(app).post(url('/refresh')).set('Cookie', cookieFor(original));
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('unauthorized');
    expect(refreshCookieHeader(reuse)).toContain('Expires=Thu, 01 Jan 1970');

    await request(app).post(url('/refresh')).set('Cookie', cookieFor(newest)).expect(401);
  });

  it('answers 401 for a missing, malformed, unknown, or injection-style cookie', async () => {
    await registerAccount(context);
    const cookies = [
      undefined,
      cookieFor(''),
      cookieFor('short'),
      cookieFor('A'.repeat(43)),
      cookieFor("' OR '1'='1"),
      'other_cookie=value',
    ];
    for (const cookie of cookies) {
      const req = request(app).post(url('/refresh'));
      const response = await (cookie === undefined ? req : req.set('Cookie', cookie));
      expect(response.status, `Cookie: ${cookie}`).toBe(401);
      expect(response.body.error.code).toBe('unauthorized');
    }
  });

  it('accepts requests from an allowed origin and from clients that send no Origin', async () => {
    const { refreshToken } = await registerAccount(context);
    const first = await request(app)
      .post(url('/refresh'))
      .set('Origin', allowedOrigin)
      .set('Cookie', cookieFor(refreshToken));
    expect(first.status).toBe(200);
    await request(app)
      .post(url('/refresh'))
      .set('Cookie', cookieFor(refreshTokenOf(first)))
      .expect(200);
  });

  it('refuses other origins with 403 without consuming the token', async () => {
    const { refreshToken } = await registerAccount(context);
    for (const origin of [
      'https://evil.example',
      'null',
      `${allowedOrigin}.evil.example`,
      allowedOrigin.toUpperCase(),
    ]) {
      const response = await request(app)
        .post(url('/refresh'))
        .set('Origin', origin)
        .set('Cookie', cookieFor(refreshToken));
      expect(response.status, `Origin: ${origin}`).toBe(403);
      expect(response.body.error.code).toBe('forbidden');
    }
    // The token was never used, so it still works.
    await request(app).post(url('/refresh')).set('Cookie', cookieFor(refreshToken)).expect(200);
  });
});

describe('POST /auth/logout', () => {
  it('ends the session: 204, cookie cleared, refresh token no longer works', async () => {
    const { refreshToken } = await registerAccount(context);
    const response = await request(app).post(url('/logout')).set('Cookie', cookieFor(refreshToken));

    expect(response.status).toBe(204);
    expect(refreshCookieHeader(response)).toContain('Expires=Thu, 01 Jan 1970');
    await request(app).post(url('/refresh')).set('Cookie', cookieFor(refreshToken)).expect(401);
  });

  it('is idempotent and works without a cookie', async () => {
    const { refreshToken } = await registerAccount(context);
    await request(app).post(url('/logout')).set('Cookie', cookieFor(refreshToken)).expect(204);
    await request(app).post(url('/logout')).set('Cookie', cookieFor(refreshToken)).expect(204);
    await request(app).post(url('/logout')).expect(204);
  });

  it('refuses other origins with 403 and leaves the session intact', async () => {
    const { refreshToken } = await registerAccount(context);
    const response = await request(app)
      .post(url('/logout'))
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookieFor(refreshToken));
    expect(response.status).toBe(403);
    await request(app).post(url('/refresh')).set('Cookie', cookieFor(refreshToken)).expect(200);
  });
});

describe('production cookie attributes', () => {
  it('marks the refresh cookie Secure when secure cookies are enabled', async () => {
    const production = createTestContext({ secureCookies: true });
    try {
      const response = await request(production.app)
        .post(url('/register'))
        .send({ email: 'secure@example.test', displayName: 'Sec', password: PASSWORD });
      expect(response.status).toBe(201);
      expect(refreshCookieHeader(response)).toContain('Secure');
    } finally {
      await production.close();
    }
  });
});

describe('rate limiting', () => {
  const minute = 60 * 1000;
  const lenient = { windowMs: 60 * minute, limit: 100_000 };
  const limits = (overrides: Partial<RateLimitSettings>): RateLimitSettings => ({
    register: lenient,
    loginPerIp: lenient,
    loginPerEmail: lenient,
    refresh: lenient,
    invite: lenient,
    signaling: lenient,
    ...overrides,
  });

  async function withLimits(
    overrides: Partial<RateLimitSettings>,
    run: (limited: TestContext) => Promise<void>,
  ): Promise<void> {
    const limited = createTestContext({ rateLimits: limits(overrides) });
    try {
      await run(limited);
    } finally {
      await limited.close();
    }
  }

  const register = (limited: TestContext, email: string) =>
    request(limited.app)
      .post(url('/register'))
      .send({ email, displayName: 'Ana', password: PASSWORD });
  const login = (limited: TestContext, email: string, password: string) =>
    request(limited.app).post(url('/login')).send({ email, password });

  it('limits registrations per client address and says when to retry', async () => {
    await withLimits({ register: { windowMs: 60 * minute, limit: 2 } }, async (limited) => {
      await register(limited, 'a@example.test').expect(201);
      await register(limited, 'b@example.test').expect(201);
      const blocked = await register(limited, 'c@example.test');

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('rate_limited');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(await countRows(limited, 'users')).toBe(2);
    });
  });

  it('blocks further logins for an email after too many failures, even with the right password', async () => {
    await withLimits({ loginPerEmail: { windowMs: 15 * minute, limit: 3 } }, async (limited) => {
      await register(limited, EMAIL).expect(201);
      for (let attempt = 0; attempt < 3; attempt++) {
        await login(limited, EMAIL, 'wrong password').expect(401);
      }
      const blocked = await login(limited, EMAIL, PASSWORD);
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
    });
  });

  it('counts the same email in any letter case against one limit', async () => {
    await withLimits({ loginPerEmail: { windowMs: 15 * minute, limit: 2 } }, async (limited) => {
      await login(limited, 'ana@example.test', 'wrong password').expect(401);
      await login(limited, 'ANA@example.test', 'wrong password').expect(401);
      await login(limited, ' Ana@Example.test ', 'wrong password').expect(429);
    });
  });

  it('does not count successful logins', async () => {
    await withLimits(
      {
        loginPerEmail: { windowMs: 15 * minute, limit: 2 },
        loginPerIp: { windowMs: 15 * minute, limit: 2 },
      },
      async (limited) => {
        await register(limited, EMAIL).expect(201);
        for (let attempt = 0; attempt < 5; attempt++) {
          await login(limited, EMAIL, PASSWORD).expect(200);
        }
      },
    );
  });

  it('limits failed logins per client address across different emails', async () => {
    await withLimits({ loginPerIp: { windowMs: 15 * minute, limit: 3 } }, async (limited) => {
      for (const email of ['a@example.test', 'b@example.test', 'c@example.test']) {
        await login(limited, email, 'wrong password').expect(401);
      }
      await login(limited, 'd@example.test', 'wrong password').expect(429);
    });
  });

  it('limits refresh requests per client address', async () => {
    await withLimits({ refresh: { windowMs: 15 * minute, limit: 2 } }, async (limited) => {
      await request(limited.app).post(url('/refresh')).expect(401);
      await request(limited.app).post(url('/refresh')).expect(401);
      await request(limited.app).post(url('/refresh')).expect(429);
    });
  });
});

describe('secrets never appear in logs', () => {
  it('keeps passwords, tokens, cookies, and emails out of the request log', async () => {
    context.logs.length = 0;
    const { accessToken, refreshToken } = await registerAccount(context);
    const login = await request(app).post(url('/login')).send({ email: EMAIL, password: PASSWORD });
    await request(app).post(url('/login')).send({ email: EMAIL, password: 'wrong-password-value' });
    const refreshed = await request(app)
      .post(url('/refresh'))
      .set('Cookie', cookieFor(refreshToken));
    await request(app).get(url('/me')).set('Authorization', `Bearer ${accessToken}`);
    await request(app)
      .post(url('/logout'))
      .set('Cookie', cookieFor(refreshTokenOf(refreshed)));

    const logText = JSON.stringify(context.logs);
    for (const secret of [
      PASSWORD,
      'wrong-password-value',
      accessToken,
      login.body.accessToken,
      refreshToken,
      refreshTokenOf(login),
      refreshTokenOf(refreshed),
      refreshed.body.accessToken,
      EMAIL,
    ]) {
      expect(logText).not.toContain(secret);
    }
    expect(
      context.logs.filter((entry) => entry['event'] === 'request').length,
    ).toBeGreaterThanOrEqual(6);
    expect(context.logs.some((entry) => typeof entry['userId'] === 'string')).toBe(true);
  });
});
