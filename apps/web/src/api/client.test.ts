import { describe, expect, it, vi } from 'vitest';
import { apiError, createFakeApi, reply, sequence } from '../test/fakeApi';
import { createApiClient, type RefreshLock } from './client';
import { ApiError } from './errors';

const ME = 'GET /api/v1/auth/me';
const REFRESH = 'POST /api/v1/auth/refresh';
const LOGIN = 'POST /api/v1/auth/login';

async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected the request to fail');
}

describe('requests', () => {
  it('sends JSON with an Accept header and the bearer token once one is set', async () => {
    const api = createFakeApi({ 'POST /api/v1/meetings': () => reply(201, { ok: true }) });
    const client = createApiClient({ fetch: api.fetch });
    client.setAccessToken('token-123');

    await client.request('POST', '/meetings', { body: { title: 'x' } });

    const [call] = api.calls;
    expect(call?.headers.get('Authorization')).toBe('Bearer token-123');
    expect(call?.headers.get('Content-Type')).toBe('application/json');
    expect(call?.headers.get('Accept')).toBe('application/json');
    expect(call?.body).toEqual({ title: 'x' });
  });

  it('sends no Authorization header without a token or when asked not to', async () => {
    const api = createFakeApi({ [ME]: () => reply(200, {}), [LOGIN]: () => reply(200, {}) });
    const client = createApiClient({ fetch: api.fetch });
    await client.request('GET', '/auth/me');
    client.setAccessToken('token-123');
    await client.request('POST', '/auth/login', { body: {}, authenticated: false });
    expect(api.calls.map((call) => call.headers.has('Authorization'))).toEqual([false, false]);
  });

  it('returns the parsed body, and undefined for an empty 204 answer', async () => {
    const api = createFakeApi({
      [ME]: () => reply(200, { user: { id: '1' } }),
      'POST /api/v1/auth/logout': () => reply(204),
    });
    const client = createApiClient({ fetch: api.fetch });
    expect(await client.request('GET', '/auth/me')).toEqual({ user: { id: '1' } });
    expect(await client.request('POST', '/auth/logout')).toBeUndefined();
  });

  it('never keeps the access token in browser storage', async () => {
    const client = createApiClient({ fetch: createFakeApi().fetch });
    client.setAccessToken('super-secret-token');
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('super-secret-token');
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('super-secret-token');
    expect(document.cookie).not.toContain('super-secret-token');
  });
});

describe('errors', () => {
  it('turns an error answer into an ApiError with code, status and field details', async () => {
    const api = createFakeApi({
      [LOGIN]: () => apiError(400, 'validation_error', [{ path: 'email', code: 'invalid_format' }]),
    });
    const error = await failureOf(
      createApiClient({ fetch: api.fetch }).request('POST', '/auth/login', {
        body: {},
        authenticated: false,
      }),
    );
    expect(error).toMatchObject({
      status: 400,
      code: 'validation_error',
      details: [{ path: 'email', code: 'invalid_format' }],
    });
  });

  it('does not keep the server’s English message', async () => {
    const api = createFakeApi({ [LOGIN]: () => apiError(401, 'invalid_credentials') });
    const error = await failureOf(
      createApiClient({ fetch: api.fetch }).request('POST', '/auth/login', {
        authenticated: false,
      }),
    );
    expect(error.message).toBe('invalid_credentials');
    expect(JSON.stringify(error)).not.toContain('English message');
  });

  it('reads Retry-After on rate-limit answers', async () => {
    const api = createFakeApi({
      [LOGIN]: () => apiError(429, 'rate_limited', undefined, { 'Retry-After': '120' }),
    });
    const error = await failureOf(
      createApiClient({ fetch: api.fetch }).request('POST', '/auth/login', {
        authenticated: false,
      }),
    );
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', retryAfterSeconds: 120 });
  });

  it('answers unknown_error for bodies that are not the API’s format or use an unknown code', async () => {
    for (const body of [
      '<html>Bad gateway</html>',
      { error: { code: 'something_new' } },
      { nothing: true },
    ]) {
      const api = createFakeApi({
        [ME]: () => ({ status: 502, headers: { 'Content-Type': 'text/html' }, body }),
      });
      const error = await failureOf(
        createApiClient({ fetch: api.fetch }).request('GET', '/auth/me', { authenticated: false }),
      );
      expect(error).toMatchObject({ status: 502, code: 'unknown_error' });
    }
  });

  it('reports a request that got no answer as a network error', async () => {
    const client = createApiClient({
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(await failureOf(client.request('GET', '/auth/me'))).toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  it('reports a successful answer that is not JSON as unknown_error', async () => {
    const client = createApiClient({
      fetch: () => Promise.resolve(new Response('not json', { status: 200 })),
    });
    expect(await failureOf(client.request('GET', '/auth/me'))).toMatchObject({
      code: 'unknown_error',
    });
  });
});

describe('session refresh on 401', () => {
  it('refreshes once and retries the request with the new token', async () => {
    const api = createFakeApi({
      [ME]: sequence(
        reply(401, { error: { code: 'unauthorized' } }),
        reply(200, { user: { id: '1' } }),
      ),
      [REFRESH]: () => reply(200, { accessToken: 'new-token' }),
    });
    const client = createApiClient({ fetch: api.fetch });
    client.setAccessToken('expired-token');

    expect(await client.request('GET', '/auth/me')).toEqual({ user: { id: '1' } });

    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([ME, REFRESH, ME]);
    expect(api.calls[0]?.headers.get('Authorization')).toBe('Bearer expired-token');
    expect(api.calls[1]?.headers.has('Authorization')).toBe(false); // refresh uses the cookie only
    expect(api.calls[2]?.headers.get('Authorization')).toBe('Bearer new-token');
  });

  it('shares one refresh between requests that fail at the same time', async () => {
    let refreshes = 0;
    const api = createFakeApi({
      [ME]: (request) =>
        request.headers.get('Authorization') === 'Bearer new-token'
          ? reply(200, { user: { id: '1' } })
          : apiError(401, 'unauthorized'),
      [REFRESH]: async () => {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return reply(200, { accessToken: 'new-token' });
      },
    });
    const client = createApiClient({ fetch: api.fetch });
    client.setAccessToken('expired-token');

    await Promise.all([
      client.request('GET', '/auth/me'),
      client.request('GET', '/auth/me'),
      client.request('GET', '/auth/me'),
    ]);

    expect(refreshes).toBe(1);
  });

  it('does not loop: a second 401 after refreshing is returned as an error', async () => {
    const api = createFakeApi({
      [ME]: () => apiError(401, 'unauthorized'),
      [REFRESH]: () => reply(200, { accessToken: 'new-token' }),
    });
    const client = createApiClient({ fetch: api.fetch });
    const error = await failureOf(client.request('GET', '/auth/me'));
    expect(error.code).toBe('unauthorized');
    expect(api.calls).toHaveLength(3); // request, refresh, one retry
  });

  it('ends the session when the server refuses to refresh: callback once, token dropped', async () => {
    const onSessionExpired = vi.fn();
    const api = createFakeApi({
      [ME]: () => apiError(401, 'unauthorized'),
      [REFRESH]: () => apiError(401, 'unauthorized'),
    });
    const client = createApiClient({ fetch: api.fetch, onSessionExpired });
    client.setAccessToken('old-token');

    expect(await failureOf(client.request('GET', '/auth/me'))).toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);

    await failureOf(client.request('GET', '/auth/me'));
    const lastRequestWithToken = api.calls.filter((call) => call.path === '/api/v1/auth/me').at(-1);
    expect(lastRequestWithToken?.headers.has('Authorization')).toBe(false);
  });

  it('keeps the session when the refresh fails for a reason other than refusal', async () => {
    const onSessionExpired = vi.fn();
    const api = createFakeApi({
      [ME]: () => apiError(401, 'unauthorized'),
      [REFRESH]: () => apiError(503, 'internal_error'),
    });
    const client = createApiClient({ fetch: api.fetch, onSessionExpired });
    expect(await failureOf(client.request('GET', '/auth/me'))).toMatchObject({ status: 503 });
    expect(onSessionExpired).not.toHaveBeenCalled();

    const offline = createApiClient({
      onSessionExpired,
      fetch: (input, init) =>
        String(input).endsWith('/auth/refresh')
          ? Promise.reject(new TypeError('offline'))
          : api.fetch(input, init),
    });
    expect(await failureOf(offline.request('GET', '/auth/me'))).toMatchObject({
      code: 'network_error',
    });
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('does not try to refresh when an unauthenticated call fails (a wrong password is not an expired session)', async () => {
    const api = createFakeApi({ [LOGIN]: () => apiError(401, 'invalid_credentials') });
    const client = createApiClient({ fetch: api.fetch });
    const error = await failureOf(
      client.request('POST', '/auth/login', { body: {}, authenticated: false }),
    );
    expect(error.code).toBe('invalid_credentials');
    expect(api.calls).toHaveLength(1);
  });
});

describe('refreshSession', () => {
  it('stores the new token and shares one request between simultaneous calls', async () => {
    let refreshes = 0;
    const api = createFakeApi({
      [REFRESH]: async () => {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return reply(200, { accessToken: 'fresh' });
      },
      [ME]: (request) => reply(200, { sent: request.headers.get('Authorization') }),
    });
    const client = createApiClient({ fetch: api.fetch });

    await Promise.all([client.refreshSession(), client.refreshSession()]);
    expect(refreshes).toBe(1);
    expect(await client.request('GET', '/auth/me')).toEqual({ sent: 'Bearer fresh' });

    await client.refreshSession(); // a later call starts a new refresh
    expect(refreshes).toBe(2);
  });

  it('runs inside the refresh lock, so other tabs cannot refresh at the same time', async () => {
    const order: string[] = [];
    const lock: RefreshLock = async (work) => {
      order.push('lock acquired');
      const result = await work();
      order.push('lock released');
      return result;
    };
    const api = createFakeApi({
      [REFRESH]: () => {
        order.push('refresh request');
        return reply(200, { accessToken: 'fresh' });
      },
    });
    await createApiClient({ fetch: api.fetch, refreshLock: lock }).refreshSession();
    expect(order).toEqual(['lock acquired', 'refresh request', 'lock released']);
  });

  it('rejects an answer without an access token', async () => {
    const api = createFakeApi({ [REFRESH]: () => reply(200, { something: 'else' }) });
    const client = createApiClient({ fetch: api.fetch });
    await expect(client.refreshSession()).rejects.toMatchObject({ code: 'unknown_error' });
  });

  it('can be retried after a failure', async () => {
    const api = createFakeApi({
      [REFRESH]: sequence(apiError(401, 'unauthorized'), reply(200, { accessToken: 'fresh' })),
    });
    const client = createApiClient({ fetch: api.fetch });
    await expect(client.refreshSession()).rejects.toBeInstanceOf(ApiError);
    await expect(client.refreshSession()).resolves.toBeUndefined();
  });
});
