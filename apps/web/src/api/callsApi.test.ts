import { describe, expect, it } from 'vitest';
import { apiError, createFakeApi, reply, type Handler } from '../test/fakeApi';
import { createCallsApi } from './callsApi';
import { createApiClient } from './client';

function setup(routes: Record<string, Handler>) {
  const fake = createFakeApi(routes);
  const client = createApiClient({ fetch: fake.fetch });
  client.setAccessToken('token');
  return { fake, calls: createCallsApi(client) };
}

describe('callsApi', () => {
  it('asks for a ticket for a meeting', async () => {
    const { fake, calls } = setup({
      'POST /api/v1/ws-tickets': () => reply(201, { ticket: 'abc', expiresInSeconds: 30 }),
    });
    expect(await calls.requestTicket('meeting-1')).toEqual({ ticket: 'abc', expiresInSeconds: 30 });
    expect(fake.calls[0]?.body).toEqual({ meetingId: 'meeting-1' });
    expect(fake.calls[0]?.headers.get('Authorization')).toBe('Bearer token');
  });

  it('passes the API’s refusals through with their codes', async () => {
    for (const [status, code] of [
      [404, 'not_found'],
      [409, 'invalid_state'],
      [429, 'rate_limited'],
    ] as const) {
      const { calls } = setup({ 'POST /api/v1/ws-tickets': () => apiError(status, code) });
      await expect(calls.requestTicket('m'), code).rejects.toMatchObject({ status, code });
    }
  });

  it('refuses tickets that are not in the documented shape', async () => {
    for (const body of [
      {},
      { ticket: '', expiresInSeconds: 30 },
      { ticket: 5, expiresInSeconds: 30 },
      { ticket: 'x' },
      'text',
    ]) {
      const { calls } = setup({ 'POST /api/v1/ws-tickets': () => reply(201, body) });
      await expect(calls.requestTicket('m'), JSON.stringify(body)).rejects.toMatchObject({
        code: 'unknown_error',
      });
    }
  });

  it('lists ICE servers, with TURN credentials when present', async () => {
    const { calls } = setup({
      'GET /api/v1/ice-servers': () =>
        reply(200, {
          iceServers: [
            { urls: ['stun:stun.example:3478'] },
            {
              urls: ['turn:relay.example:3478'],
              username: '1893456000:user',
              credential: 'secret-credential',
            },
          ],
        }),
    });
    expect(await calls.iceServers()).toEqual([
      { urls: ['stun:stun.example:3478'] },
      {
        urls: ['turn:relay.example:3478'],
        username: '1893456000:user',
        credential: 'secret-credential',
      },
    ]);
  });

  it('accepts an empty list of ICE servers', async () => {
    const { calls } = setup({ 'GET /api/v1/ice-servers': () => reply(200, { iceServers: [] }) });
    expect(await calls.iceServers()).toEqual([]);
  });

  it('refuses ICE server lists that are not in the documented shape', async () => {
    for (const body of [
      {},
      { iceServers: 'x' },
      { iceServers: [{}] },
      { iceServers: [{ urls: [1] }] },
      { iceServers: [{ urls: ['stun:a'], username: 5 }] },
    ]) {
      const { calls } = setup({ 'GET /api/v1/ice-servers': () => reply(200, body) });
      await expect(calls.iceServers(), JSON.stringify(body)).rejects.toMatchObject({
        code: 'unknown_error',
      });
    }
  });
});
