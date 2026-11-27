import { describe, expect, it } from 'vitest';
import { apiError, createFakeApi, reply } from '../test/fakeApi';
import { createAuthApi } from './authApi';
import { createApiClient } from './client';

const USER = { id: 'u1', email: 'ana@example.test', displayName: 'Ana' };

function setup(routes: Parameters<typeof createFakeApi>[0]) {
  const api = createFakeApi(routes);
  const client = createApiClient({ fetch: api.fetch });
  return { api, client, auth: createAuthApi(client) };
}

describe('authApi', () => {
  it('logs in, returns the user, and uses the token for later requests', async () => {
    const { api, auth } = setup({
      'POST /api/v1/auth/login': () => reply(200, { user: USER, accessToken: 'tok' }),
      'GET /api/v1/auth/me': () => reply(200, { user: USER }),
    });
    expect(await auth.login({ email: 'ana@example.test', password: 'a-long-password' })).toEqual(
      USER,
    );
    await auth.currentUser();
    expect(api.calls[0]?.body).toEqual({ email: 'ana@example.test', password: 'a-long-password' });
    expect(api.calls[1]?.headers.get('Authorization')).toBe('Bearer tok');
  });

  it('registers with the display name', async () => {
    const { api, auth } = setup({
      'POST /api/v1/auth/register': () => reply(201, { user: USER, accessToken: 'tok' }),
    });
    await auth.register({
      email: 'ana@example.test',
      password: 'a-long-password',
      displayName: 'Ana',
    });
    expect(api.calls[0]?.body).toEqual({
      email: 'ana@example.test',
      password: 'a-long-password',
      displayName: 'Ana',
    });
  });

  it('passes API errors through for the UI to translate', async () => {
    const { auth } = setup({
      'POST /api/v1/auth/login': () => apiError(401, 'invalid_credentials'),
    });
    await expect(auth.login({ email: 'a@b.test', password: 'x' })).rejects.toMatchObject({
      status: 401,
      code: 'invalid_credentials',
    });
  });

  it('refuses answers that are not in the documented shape', async () => {
    const { auth } = setup({
      'POST /api/v1/auth/login': () => reply(200, { user: { id: 1 }, accessToken: 'tok' }),
      'POST /api/v1/auth/register': () => reply(201, { user: USER }),
      'GET /api/v1/auth/me': () => reply(200, { user: null }),
    });
    await expect(auth.login({ email: 'a@b.test', password: 'x' })).rejects.toMatchObject({
      code: 'unknown_error',
    });
    await expect(
      auth.register({ email: 'a@b.test', password: 'x'.repeat(12), displayName: 'A' }),
    ).rejects.toMatchObject({ code: 'unknown_error' });
    await expect(auth.currentUser()).rejects.toMatchObject({ code: 'unknown_error' });
  });

  it('logout forgets the token even when the server cannot be reached', async () => {
    const api = createFakeApi({
      'POST /api/v1/auth/login': () => reply(200, { user: USER, accessToken: 'tok' }),
      'GET /api/v1/auth/me': (request) =>
        reply(200, { user: USER, sent: request.headers.has('Authorization') }),
    });
    let online = true;
    const client = createApiClient({
      fetch: (input, init) =>
        online ? api.fetch(input, init) : Promise.reject(new TypeError('offline')),
    });
    const auth = createAuthApi(client);
    await auth.login({ email: 'a@b.test', password: 'x' });

    online = false;
    await expect(auth.logout()).rejects.toMatchObject({ code: 'network_error' });

    online = true;
    const answer = await client.request<{ sent: boolean }>('GET', '/auth/me');
    expect(answer.sent).toBe(false); // the token is gone
  });
});
