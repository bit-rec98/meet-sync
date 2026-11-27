import type { RowDataPacket } from 'mysql2/promise';
import request, { type Response } from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { insertInvitee } from '../../repositories/meetingInvitees.js';
import type { UserRecord } from '../../repositories/users.js';
import { createTestContext, LENIENT_RATE_LIMITS, type TestContext } from '../../test/app.js';
import { clearAllTables } from '../../test/database.js';
import { accessTokenFor, insertTestUser } from '../../test/fixtures.js';

const BASE = '/api/v1/meetings';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const context = createTestContext();
const { app } = context;

type Actor = UserRecord;

/** Signs a token with the app's current (adjustable) clock, so it never expires mid-test. */
async function bearer(actor: Actor, from: TestContext = context): Promise<string> {
  return `Bearer ${await accessTokenFor(actor.id, from.config.accessTokenSecret, from.clock.current)}`;
}

async function get(actor: Actor, path: string): Promise<Response> {
  return request(app)
    .get(path)
    .set('Authorization', await bearer(actor));
}
async function post(actor: Actor, path: string, body?: object): Promise<Response> {
  return request(app)
    .post(path)
    .set('Authorization', await bearer(actor))
    .send(body);
}
async function patch(actor: Actor, path: string, body?: object): Promise<Response> {
  return request(app)
    .patch(path)
    .set('Authorization', await bearer(actor))
    .send(body);
}
async function del(actor: Actor, path: string): Promise<Response> {
  return request(app)
    .delete(path)
    .set('Authorization', await bearer(actor));
}

/** Awaits a response and checks its status, for the helpers above (which return plain promises). */
async function expectStatus(pending: Promise<Response>, status: number): Promise<Response> {
  const response = await pending;
  expect(response.status).toBe(status);
  return response;
}

const startsInDays = (days: number): string =>
  new Date(context.clock.current.getTime() + days * DAY_MS).toISOString();

const meetingBody = (overrides: Record<string, unknown> = {}) => ({
  title: 'Weekly sync',
  description: 'Agenda',
  startsAt: startsInDays(1),
  durationMinutes: 60,
  callType: 'video',
  ...overrides,
});

async function rowCount(table: 'meetings' | 'meeting_invitees'): Promise<number> {
  const [rows] = await context.pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM \`${table}\``,
  );
  return Number(rows[0]?.['total']);
}

describe('meeting routes', () => {
  let host: Actor;
  let guest: Actor;
  let stranger: Actor;

  async function createMeeting(
    overrides: Record<string, unknown> = {},
    options: { inviteGuest?: boolean } = {},
  ): Promise<{ id: string; startsAt: string }> {
    const created = await post(host, BASE, meetingBody(overrides));
    expect(created.status).toBe(201);
    if (options.inviteGuest ?? true) {
      await expectStatus(
        post(host, `${BASE}/${created.body.id}/invitees`, { email: guest.email }),
        201,
      );
    }
    return created.body;
  }

  beforeEach(async () => {
    context.clock.current = new Date();
    await clearAllTables(context.pool);
    host = await insertTestUser(context.pool, {
      email: 'host@example.test',
      displayName: 'Hana Host',
    });
    guest = await insertTestUser(context.pool, {
      email: 'guest@example.test',
      displayName: 'Gus Guest',
    });
    stranger = await insertTestUser(context.pool, {
      email: 'stranger@example.test',
      displayName: 'Sam',
    });
  });
  afterAll(() => context.close());

  describe('authentication', () => {
    const routes: [string, string][] = [
      ['post', BASE],
      ['get', BASE],
      ['get', `${BASE}/${UNKNOWN_ID}`],
      ['patch', `${BASE}/${UNKNOWN_ID}`],
      ['delete', `${BASE}/${UNKNOWN_ID}`],
      ['post', `${BASE}/${UNKNOWN_ID}/invitees`],
      ['delete', `${BASE}/${UNKNOWN_ID}/invitees/${UNKNOWN_ID}`],
    ];

    it.each(routes)('%s %s requires a valid access token', async (method, path) => {
      const send = (authorization?: string) => {
        const call = request(app)[method as 'get'](path);
        return authorization === undefined ? call : call.set('Authorization', authorization);
      };
      for (const authorization of [undefined, 'Bearer garbage', 'Bearer a.b.c', 'Basic abc']) {
        const response = await send(authorization);
        expect(response.status, `${method} ${path} with ${authorization}`).toBe(401);
        expect(response.headers['www-authenticate']).toBe('Bearer');
      }
    });

    it('rejects an expired access token', async () => {
      const token = await bearer(host);
      context.clock.current = new Date(context.clock.current.getTime() + 16 * MINUTE_MS);
      await request(app).get(BASE).set('Authorization', token).expect(401);
    });
  });

  describe('POST /meetings', () => {
    it('creates a meeting hosted by the caller and returns it', async () => {
      const response = await post(host, BASE, meetingBody());
      expect(response.status).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        title: 'Weekly sync',
        description: 'Agenda',
        startsAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        durationMinutes: 60,
        callType: 'video',
        status: 'scheduled',
        role: 'host',
        host: { id: host.id, displayName: 'Hana Host' },
        invitees: [],
      });
    });

    it('normalizes the start time to UTC and defaults the description to null', async () => {
      const { description: _omitted, ...withoutDescription } = meetingBody({
        startsAt: new Date(context.clock.current.getTime() + DAY_MS)
          .toISOString()
          .replace('Z', '+02:00'),
      });
      const response = await post(host, BASE, withoutDescription);
      expect(response.status).toBe(201);
      expect(response.body.description).toBeNull();
      expect(response.body.startsAt.endsWith('Z')).toBe(true);
      // +02:00 means two hours earlier in UTC than the same wall-clock digits with Z.
      expect(new Date(response.body.startsAt).getTime()).toBe(
        new Date(startsInDays(1)).getTime() - 2 * HOUR_MS,
      );
    });

    it('answers 400 with field details when the body breaks a rule, and creates nothing', async () => {
      const response = await post(
        host,
        BASE,
        meetingBody({ title: '', durationMinutes: 4, callType: 'screen' }),
      );
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([
          { path: 'title', code: 'too_small' },
          { path: 'durationMinutes', code: 'too_small' },
          { path: 'callType', code: 'invalid_value' },
        ]),
      );
      expect(await rowCount('meetings')).toBe(0);
    });

    it('answers 400 for a start time in the past or too far ahead', async () => {
      const past = await post(
        host,
        BASE,
        meetingBody({
          startsAt: new Date(context.clock.current.getTime() - HOUR_MS).toISOString(),
        }),
      );
      expect(past.status).toBe(400);
      expect(past.body.error.details).toEqual([{ path: 'startsAt', code: 'in_the_past' }]);

      const far = await post(host, BASE, meetingBody({ startsAt: startsInDays(366) }));
      expect(far.body.error.details).toEqual([{ path: 'startsAt', code: 'too_far_ahead' }]);
      expect(await rowCount('meetings')).toBe(0);
    });

    it('never lets the client choose the host or the status', async () => {
      for (const extra of [
        { hostId: stranger.id },
        { status: 'ended' },
        { id: UNKNOWN_ID },
        { role: 'host' },
      ]) {
        const response = await post(host, BASE, meetingBody(extra));
        expect(response.status).toBe(400);
        expect(response.body.error.details[0].code).toBe('unrecognized_key');
      }
      expect(await rowCount('meetings')).toBe(0);
    });

    it('rejects bodies that are not JSON (415), malformed (400) or too large (413)', async () => {
      const token = await bearer(host);
      const form = await request(app)
        .post(BASE)
        .set('Authorization', token)
        .type('form')
        .send({ title: 'x' });
      expect(form.status).toBe(415);
      const malformed = await request(app)
        .post(BASE)
        .set('Authorization', token)
        .set('Content-Type', 'application/json')
        .send('{"title":');
      expect(malformed.status).toBe(400);
      const huge = await post(host, BASE, meetingBody({ description: 'x'.repeat(101 * 1024) }));
      expect(huge.status).toBe(413);
      expect(await rowCount('meetings')).toBe(0);
    });
  });

  describe('GET /meetings', () => {
    it('lists upcoming meetings of the user, with role, host and invitee count', async () => {
      const mine = await createMeeting({ title: 'Mine' });
      await expectStatus(post(stranger, BASE, meetingBody({ title: 'Not mine' })), 201);
      const response = await get(host, BASE);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        items: [
          {
            id: mine.id,
            title: 'Mine',
            description: 'Agenda',
            startsAt: mine.startsAt,
            durationMinutes: 60,
            callType: 'video',
            status: 'scheduled',
            role: 'host',
            host: { id: host.id, displayName: 'Hana Host' },
            inviteeCount: 1,
          },
        ],
        limit: 20,
        offset: 0,
        total: 1,
      });
    });

    it('shows invited meetings to the invitee with the invitee role and no email addresses', async () => {
      await createMeeting();
      const response = await get(guest, BASE);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0].role).toBe('invitee');
      expect(JSON.stringify(response.body)).not.toContain('@example.test');
    });

    it('moves meetings to past when they end, and paginates', async () => {
      await createMeeting({ title: 'First', startsAt: startsInDays(1) }, { inviteGuest: false });
      await createMeeting({ title: 'Second', startsAt: startsInDays(2) }, { inviteGuest: false });
      await createMeeting({ title: 'Third', startsAt: startsInDays(3) }, { inviteGuest: false });

      const page = await get(host, `${BASE}?limit=2&offset=1`);
      expect(page.body.items.map((item: { title: string }) => item.title)).toEqual([
        'Second',
        'Third',
      ]);
      expect(page.body).toMatchObject({ limit: 2, offset: 1, total: 3 });

      context.clock.current = new Date(context.clock.current.getTime() + 2.5 * DAY_MS);
      const past = await get(host, `${BASE}?when=past`);
      expect(past.body.items.map((item: { title: string }) => item.title)).toEqual([
        'Second',
        'First',
      ]);
      const upcoming = await get(host, BASE);
      expect(upcoming.body.items.map((item: { title: string }) => item.title)).toEqual(['Third']);
    });

    it('rejects invalid query parameters with 400', async () => {
      for (const query of [
        'limit=0',
        'limit=51',
        'limit=abc',
        'offset=-1',
        'when=all',
        'sort=desc',
        'limit=1&limit=2',
      ]) {
        const response = await get(host, `${BASE}?${query}`);
        expect(response.status, query).toBe(400);
        expect(response.body.error.code).toBe('validation_error');
      }
    });
  });

  describe('GET /meetings/:id', () => {
    it('shows the host the invitees with their emails', async () => {
      const meeting = await createMeeting();
      const response = await get(host, `${BASE}/${meeting.id}`);
      expect(response.status).toBe(200);
      expect(response.body.role).toBe('host');
      expect(response.body.invitees).toEqual([
        { id: guest.id, displayName: 'Gus Guest', email: 'guest@example.test' },
      ]);
    });

    it('shows an invitee the meeting without any email address', async () => {
      const meeting = await createMeeting();
      const response = await get(guest, `${BASE}/${meeting.id}`);
      expect(response.status).toBe(200);
      expect(response.body.role).toBe('invitee');
      expect(response.body.invitees).toEqual([{ id: guest.id, displayName: 'Gus Guest' }]);
      expect(JSON.stringify(response.body)).not.toContain('@example.test');
    });

    it('answers a stranger exactly as it answers a meeting that does not exist', async () => {
      const meeting = await createMeeting();
      const strangerView = await get(stranger, `${BASE}/${meeting.id}`);
      const missing = await get(stranger, `${BASE}/${UNKNOWN_ID}`);
      expect(strangerView.status).toBe(404);
      expect(strangerView.body).toEqual(missing.body);
      expect(strangerView.body.error.code).toBe('not_found');
    });

    it('answers 400 for ids that are not UUIDs', async () => {
      for (const id of ['1', 'abc', "'%20OR%201=1", '..%2F..%2Fetc']) {
        expect((await get(host, `${BASE}/${id}`)).status, id).toBe(400);
      }
    });
  });

  describe('PATCH /meetings/:id', () => {
    it('lets the host change some fields and clear the description', async () => {
      const meeting = await createMeeting();
      const changed = await patch(host, `${BASE}/${meeting.id}`, {
        title: 'Renamed',
        durationMinutes: 90,
        callType: 'audio',
        description: null,
      });
      expect(changed.status).toBe(200);
      expect(changed.body).toMatchObject({
        title: 'Renamed',
        durationMinutes: 90,
        callType: 'audio',
        description: null,
        startsAt: meeting.startsAt,
      });
      expect((await get(guest, `${BASE}/${meeting.id}`)).body.title).toBe('Renamed');
    });

    it('answers 403 to an invitee and 404 to a stranger, changing nothing', async () => {
      const meeting = await createMeeting();
      const asGuest = await patch(guest, `${BASE}/${meeting.id}`, { title: 'Hijacked' });
      const asStranger = await patch(stranger, `${BASE}/${meeting.id}`, { title: 'Hijacked' });
      expect(asGuest.status).toBe(403);
      expect(asGuest.body.error.code).toBe('forbidden');
      expect(asStranger.status).toBe(404);
      expect((await get(host, `${BASE}/${meeting.id}`)).body.title).toBe('Weekly sync');
    });

    it('answers 409 once the meeting has started', async () => {
      const meeting = await createMeeting();
      context.clock.current = new Date(new Date(meeting.startsAt).getTime());
      const response = await patch(host, `${BASE}/${meeting.id}`, { title: 'Too late' });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('invalid_state');
    });

    it('answers 400 for an empty change, a past start time, or fields that may not change', async () => {
      const meeting = await createMeeting();
      const url = `${BASE}/${meeting.id}`;
      expect((await patch(host, url, {})).status).toBe(400);
      expect(
        (
          await patch(host, url, {
            startsAt: new Date(context.clock.current.getTime() - HOUR_MS).toISOString(),
          })
        ).body.error.details,
      ).toEqual([{ path: 'startsAt', code: 'in_the_past' }]);
      for (const forbidden of [
        { hostId: stranger.id },
        { status: 'cancelled' },
        { id: UNKNOWN_ID },
      ]) {
        expect((await patch(host, url, { title: 'x', ...forbidden })).status).toBe(400);
      }
      expect((await get(host, url)).body).toMatchObject({
        title: 'Weekly sync',
        status: 'scheduled',
      });
    });
  });

  describe('DELETE /meetings/:id', () => {
    it('cancels the meeting (204), keeps it listed as past, and is idempotent', async () => {
      const meeting = await createMeeting();
      await expectStatus(del(host, `${BASE}/${meeting.id}`), 204);
      await expectStatus(del(host, `${BASE}/${meeting.id}`), 204);
      expect((await get(guest, `${BASE}/${meeting.id}`)).body.status).toBe('cancelled');
      expect((await get(host, `${BASE}?when=past`)).body.items[0]).toMatchObject({
        id: meeting.id,
        status: 'cancelled',
      });
      expect(await rowCount('meetings')).toBe(1);
    });

    it('answers 403 to an invitee, 404 to a stranger, and 409 once the meeting is over', async () => {
      const meeting = await createMeeting();
      expect((await del(guest, `${BASE}/${meeting.id}`)).status).toBe(403);
      expect((await del(stranger, `${BASE}/${meeting.id}`)).status).toBe(404);
      expect((await get(host, `${BASE}/${meeting.id}`)).body.status).toBe('scheduled');

      context.clock.current = new Date(new Date(meeting.startsAt).getTime() + 2 * HOUR_MS);
      const response = await del(host, `${BASE}/${meeting.id}`);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('invalid_state');
    });
  });

  describe('invitees', () => {
    it('invites a registered user by email, whatever its case or spacing', async () => {
      const meeting = await createMeeting({}, { inviteGuest: false });
      const response = await post(host, `${BASE}/${meeting.id}/invitees`, {
        email: '  GUEST@Example.TEST ',
      });
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: guest.id,
        displayName: 'Gus Guest',
        email: 'guest@example.test',
      });
      expect((await get(guest, `${BASE}/${meeting.id}`)).status).toBe(200);
    });

    it('reports unknown emails (404), the host and duplicates (409), and bad input (400)', async () => {
      const meeting = await createMeeting();
      const url = `${BASE}/${meeting.id}/invitees`;
      const unknown = await post(host, url, { email: 'nobody@example.test' });
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('user_not_found');
      for (const email of [host.email, guest.email]) {
        const response = await post(host, url, { email });
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('already_invited');
      }
      expect((await post(host, url, { email: 'not-an-email' })).status).toBe(400);
      expect((await post(host, url, { email: stranger.email, role: 'host' })).status).toBe(400);
      expect((await post(host, url, {})).status).toBe(400);
    });

    it('answers 403 to an invitee and 404 to a stranger who try to invite', async () => {
      const meeting = await createMeeting();
      const url = `${BASE}/${meeting.id}/invitees`;
      expect((await post(guest, url, { email: stranger.email })).status).toBe(403);
      expect((await post(stranger, url, { email: stranger.email })).status).toBe(404);
      expect(await rowCount('meeting_invitees')).toBe(1);
    });

    it('answers 409 for cancelled meetings and for meetings that are over', async () => {
      const cancelled = await createMeeting({}, { inviteGuest: false });
      await expectStatus(del(host, `${BASE}/${cancelled.id}`), 204);
      expect(
        (await post(host, `${BASE}/${cancelled.id}/invitees`, { email: guest.email })).body.error
          .code,
      ).toBe('invalid_state');

      const finished = await createMeeting({ title: 'Finished' }, { inviteGuest: false });
      context.clock.current = new Date(new Date(finished.startsAt).getTime() + 2 * HOUR_MS);
      expect(
        (await post(host, `${BASE}/${finished.id}/invitees`, { email: guest.email })).status,
      ).toBe(409);
    });

    it('allows 50 invitees and answers 409 for the 51st', async () => {
      const meeting = await createMeeting({}, { inviteGuest: false });
      for (let index = 0; index < 50; index++) {
        const user = await insertTestUser(context.pool);
        await insertInvitee(context.pool, meeting.id, user.id, new Date());
      }
      const response = await post(host, `${BASE}/${meeting.id}/invitees`, { email: guest.email });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('invitee_limit_reached');
      expect(await rowCount('meeting_invitees')).toBe(50);
    });

    it('lets the host remove any invitee, who then loses access (204)', async () => {
      const meeting = await createMeeting();
      await expectStatus(del(host, `${BASE}/${meeting.id}/invitees/${guest.id}`), 204);
      expect((await get(guest, `${BASE}/${meeting.id}`)).status).toBe(404);
    });

    it('lets an invitee remove only themselves', async () => {
      const meeting = await createMeeting();
      await expectStatus(
        post(host, `${BASE}/${meeting.id}/invitees`, { email: stranger.email }),
        201,
      );
      expect((await del(guest, `${BASE}/${meeting.id}/invitees/${stranger.id}`)).status).toBe(403);
      expect((await del(guest, `${BASE}/${meeting.id}/invitees/${host.id}`)).status).toBe(403);
      await expectStatus(del(guest, `${BASE}/${meeting.id}/invitees/${guest.id}`), 204);
      expect(
        (await get(host, `${BASE}/${meeting.id}`)).body.invitees.map(
          (invitee: { id: string }) => invitee.id,
        ),
      ).toEqual([stranger.id]);
    });

    it('answers 404 for strangers, for non-invitees, and for repeated removals', async () => {
      const meeting = await createMeeting();
      const url = (userId: string) => `${BASE}/${meeting.id}/invitees/${userId}`;
      expect((await del(stranger, url(guest.id))).status).toBe(404);
      expect((await del(host, url(stranger.id))).status).toBe(404);
      await expectStatus(del(host, url(guest.id)), 204);
      expect((await del(host, url(guest.id))).status).toBe(404);
    });

    it('limits invitations per user, not per address', async () => {
      const limited = createTestContext({
        rateLimits: { ...LENIENT_RATE_LIMITS, invite: { windowMs: HOUR_MS, limit: 2 } },
      });
      try {
        const send = async (actor: Actor, meetingId: string, email: string) =>
          request(limited.app)
            .post(`${BASE}/${meetingId}/invitees`)
            .set('Authorization', await bearer(actor, limited))
            .send({ email });
        const meetingFor = async (actor: Actor) =>
          (
            await request(limited.app)
              .post(BASE)
              .set('Authorization', await bearer(actor, limited))
              .send(meetingBody())
          ).body.id as string;
        const hostMeeting = await meetingFor(host);
        const strangerMeeting = await meetingFor(stranger);

        expect((await send(host, hostMeeting, guest.email)).status).toBe(201);
        expect((await send(host, hostMeeting, 'x@example.test')).status).toBe(404); // failures count too
        const blocked = await send(host, hostMeeting, stranger.email);
        expect(blocked.status).toBe(429);
        expect(blocked.body.error.code).toBe('rate_limited');
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

        // Same address, different user: not affected.
        expect((await send(stranger, strangerMeeting, guest.email)).status).toBe(201);
      } finally {
        await limited.close();
      }
    });
  });

  describe('access control across users', () => {
    it("never reveals or changes another user's meeting, whatever the route", async () => {
      const meeting = await createMeeting();
      const missing = await get(stranger, `${BASE}/${UNKNOWN_ID}`);
      const attempts: [string, Response][] = [
        ['get', await get(stranger, `${BASE}/${meeting.id}`)],
        ['patch', await patch(stranger, `${BASE}/${meeting.id}`, { title: 'x' })],
        ['delete', await del(stranger, `${BASE}/${meeting.id}`)],
        ['invite', await post(stranger, `${BASE}/${meeting.id}/invitees`, { email: guest.email })],
        ['uninvite', await del(stranger, `${BASE}/${meeting.id}/invitees/${guest.id}`)],
      ];
      for (const [name, response] of attempts) {
        expect(response.status, name).toBe(404);
        expect(response.body, name).toEqual(missing.body);
      }
      const list = await get(stranger, BASE);
      expect(list.body).toMatchObject({ items: [], total: 0 });

      const intact = await get(host, `${BASE}/${meeting.id}`);
      expect(intact.body).toMatchObject({ title: 'Weekly sync', status: 'scheduled' });
      expect(intact.body.invitees).toHaveLength(1);
    });

    it('keeps access tokens out of the logs', async () => {
      context.logs.length = 0;
      const token = await bearer(host);
      const created = await request(app).post(BASE).set('Authorization', token).send(meetingBody());
      await request(app).get(`${BASE}/${created.body.id}`).set('Authorization', token);
      const logText = JSON.stringify(context.logs);
      expect(logText).not.toContain(token.slice('Bearer '.length));
      expect(logText).not.toContain('host@example.test');
      expect(context.logs.some((entry) => entry['userId'] === host.id)).toBe(true);
    });
  });
});
