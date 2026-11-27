import { describe, expect, it } from 'vitest';
import { apiError, createFakeApi, reply, type FakeApi, type Handler } from '../test/fakeApi';
import { GUEST, HOST, invitee, list, meeting, summary } from '../test/meetingFixtures';
import { createApiClient } from './client';
import { createMeetingsApi } from './meetingsApi';

function setup(routes: Record<string, Handler>) {
  const fake: FakeApi = createFakeApi(routes);
  const client = createApiClient({ fetch: fake.fetch });
  client.setAccessToken('token');
  return { fake, meetings: createMeetingsApi(client) };
}

describe('meetingsApi', () => {
  it('lists with the filter and page in the query string', async () => {
    const { fake, meetings } = setup({
      'GET /api/v1/meetings?when=past&limit=20&offset=40': () =>
        reply(200, list([summary()], { offset: 40, total: 41 })),
    });
    const result = await meetings.list({ when: 'past', limit: 20, offset: 40 });
    expect(result).toMatchObject({ offset: 40, total: 41 });
    expect(result.items[0]).toMatchObject({ title: 'Weekly sync', role: 'host', inviteeCount: 0 });
    expect(fake.calls[0]?.headers.get('Authorization')).toBe('Bearer token');
  });

  it('gets a meeting with its invitees, keeping emails only when the server sent them', async () => {
    const { meetings } = setup({
      'GET /api/v1/meetings/m1': () =>
        reply(200, meeting({ invitees: [invitee(GUEST, 'guest@example.test'), invitee(HOST)] })),
    });
    const result = await meetings.get('m1');
    expect(result.invitees).toEqual([
      { ...GUEST, email: 'guest@example.test' },
      { id: HOST.id, displayName: HOST.displayName },
    ]);
  });

  it('creates, with the body as given, and returns the new meeting', async () => {
    const { fake, meetings } = setup({ 'POST /api/v1/meetings': () => reply(201, meeting()) });
    const input = {
      title: 'Sync',
      description: null,
      startsAt: '2026-12-01T15:00:00.000Z',
      durationMinutes: 30,
      callType: 'audio' as const,
    };
    expect((await meetings.create(input)).title).toBe('Weekly sync');
    expect(fake.calls[0]?.body).toEqual(input);
  });

  it('updates with a PATCH containing only the changes', async () => {
    const { fake, meetings } = setup({ 'PATCH /api/v1/meetings/m1': () => reply(200, meeting()) });
    await meetings.update('m1', { title: 'New title', description: null });
    expect(fake.calls[0]?.method).toBe('PATCH');
    expect(fake.calls[0]?.body).toEqual({ title: 'New title', description: null });
  });

  it('cancels with DELETE and removes invitees with DELETE', async () => {
    const { fake, meetings } = setup({
      'DELETE /api/v1/meetings/m1': () => reply(204),
      'DELETE /api/v1/meetings/m1/invitees/u1': () => reply(204),
    });
    await meetings.cancel('m1');
    await meetings.removeInvitee('m1', 'u1');
    expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'DELETE /api/v1/meetings/m1',
      'DELETE /api/v1/meetings/m1/invitees/u1',
    ]);
  });

  it('invites by email and returns the invitee, which must include the email', async () => {
    const { fake, meetings } = setup({
      'POST /api/v1/meetings/m1/invitees': () => reply(201, invitee(GUEST, 'guest@example.test')),
    });
    expect(await meetings.invite('m1', 'guest@example.test')).toEqual({
      ...GUEST,
      email: 'guest@example.test',
    });
    expect(fake.calls[0]?.body).toEqual({ email: 'guest@example.test' });
  });

  it('encodes ids so they cannot change the path', async () => {
    const { fake, meetings } = setup({
      'GET /api/v1/meetings/..%2Fauth%2Fme': () => reply(200, meeting()),
    });
    await meetings.get('../auth/me');
    expect(fake.unexpected).toEqual([]);
  });

  it('passes API errors through with their code', async () => {
    const { meetings } = setup({ 'GET /api/v1/meetings/m1': () => apiError(404, 'not_found') });
    await expect(meetings.get('m1')).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('refuses answers that are not in the documented shape', async () => {
    const good = summary();
    const bodies: [string, unknown][] = [
      ['a list without items', { limit: 20, offset: 0, total: 0 }],
      ['an item without a title', list([{ ...good, title: undefined } as never])],
      ['an unknown call type', list([{ ...good, callType: 'screen' } as never])],
      ['an unknown status', list([{ ...good, status: 'deleted' } as never])],
      ['a start time that is not a date', list([{ ...good, startsAt: 'tomorrow' }])],
      ['a negative count', list([{ ...good, inviteeCount: -1 }])],
      ['a host without a name', list([{ ...good, host: { id: 'x' } } as never])],
      ['text instead of an object', 'oops'],
    ];
    for (const [name, body] of bodies) {
      const { meetings } = setup({
        'GET /api/v1/meetings?when=upcoming&limit=20&offset=0': () => reply(200, body),
      });
      await expect(
        meetings.list({ when: 'upcoming', limit: 20, offset: 0 }),
        name,
      ).rejects.toMatchObject({ code: 'unknown_error' });
    }
  });

  it('refuses a meeting whose invitees are not a list, and an invite answer without an email', async () => {
    const { meetings } = setup({
      'GET /api/v1/meetings/m1': () => reply(200, { ...meeting(), invitees: 'none' }),
      'POST /api/v1/meetings/m1/invitees': () => reply(201, GUEST),
    });
    await expect(meetings.get('m1')).rejects.toMatchObject({ code: 'unknown_error' });
    await expect(meetings.invite('m1', 'a@b.test')).rejects.toMatchObject({
      code: 'unknown_error',
    });
  });
});
