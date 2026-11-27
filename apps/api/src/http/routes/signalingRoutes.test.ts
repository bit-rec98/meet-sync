import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, LENIENT_RATE_LIMITS } from '../../test/app.js';
import { clearAllTables } from '../../test/database.js';
import { createPeople, scheduleMeeting, type Person } from '../../test/scenario.js';

const TICKETS = '/api/v1/ws-tickets';
const ICE = '/api/v1/ice-servers';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const TURN_SECRET = 'turn-shared-secret-for-tests-0123456789';

const context = createTestContext({
  signaling: {
    stunUrls: ['stun:stun.example:3478'],
    turn: { urls: ['turn:relay.example:3478'], sharedSecret: TURN_SECRET },
  },
});
const { app, services, clock } = context;

let host: Person;
let guest: Person;
let stranger: Person;

beforeEach(async () => {
  clock.current = new Date();
  await clearAllTables(context.pool);
  [host, guest, stranger] = (await createPeople(context, ['Hana Host', 'Gus Guest', 'Sam'])) as [
    Person,
    Person,
    Person,
  ];
});
afterAll(() => context.close());

const asking = async (person: Person, body: unknown) =>
  request(app)
    .post(TICKETS)
    .set('Authorization', await person.bearer())
    .send(body as object);

describe('POST /ws-tickets', () => {
  it('gives the host and an invitee a ticket that lasts 30 seconds, and nothing else', async () => {
    const before = services.tickets.size();
    const meetingId = await scheduleMeeting(context, host, [guest]);
    for (const person of [host, guest]) {
      const response = await asking(person, { meetingId });
      expect(response.status).toBe(201);
      expect(Object.keys(response.body).sort()).toEqual(['expiresInSeconds', 'ticket']);
      expect(response.body.expiresInSeconds).toBe(30);
      expect(response.body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(services.tickets.size() - before).toBe(2);
  });

  it('binds the ticket to the user and meeting that asked', async () => {
    const meetingId = await scheduleMeeting(context, host, [guest]);
    const { body } = await asking(guest, { meetingId });
    expect(services.tickets.consume(body.ticket)).toEqual({
      userId: guest.id,
      displayName: 'Gus Guest',
      meetingId,
    });
  });

  it('answers a stranger exactly as for a meeting that does not exist', async () => {
    const before = services.tickets.size();
    const meetingId = await scheduleMeeting(context, host, [guest]);
    const strangerView = await asking(stranger, { meetingId });
    const missing = await asking(stranger, { meetingId: UNKNOWN_ID });
    expect(strangerView.status).toBe(404);
    expect(strangerView.body).toEqual(missing.body);
    expect(services.tickets.size()).toBe(before); // no ticket was issued
  });

  it('refuses before the join window opens and after the meeting was cancelled', async () => {
    const later = await scheduleMeeting(context, host, [guest], { startsInMinutes: 16 });
    const tooEarly = await asking(guest, { meetingId: later });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe('invalid_state');

    clock.current = new Date(clock.current.getTime() + 60_000); // now 15 minutes before: the window opens
    expect((await asking(guest, { meetingId: later })).status).toBe(201);

    const cancelled = await scheduleMeeting(context, host, [guest]);
    await services.meetings.cancel(host.id, cancelled);
    expect((await asking(guest, { meetingId: cancelled })).status).toBe(409);
  });

  it('refuses once the meeting is over, and a person who was removed', async () => {
    const meetingId = await scheduleMeeting(context, host, [guest], { durationMinutes: 30 });
    await services.meetings.removeInvitee(host.id, meetingId, guest.id);
    expect((await asking(guest, { meetingId })).status).toBe(404);

    clock.current = new Date(clock.current.getTime() + 40 * 60_000);
    expect((await asking(host, { meetingId })).status).toBe(409);
  });

  it('needs a valid access token', async () => {
    const before = services.tickets.size();
    const meetingId = await scheduleMeeting(context, host, []);
    for (const authorization of [undefined, 'Bearer garbage', 'Basic abc']) {
      const call = request(app).post(TICKETS).send({ meetingId });
      const response = await (authorization === undefined
        ? call
        : call.set('Authorization', authorization));
      expect(response.status, String(authorization)).toBe(401);
    }
    expect(services.tickets.size()).toBe(before);
  });

  it('validates the body: only a meeting id that is a UUID', async () => {
    for (const body of [
      {},
      { meetingId: 'x' },
      { meetingId: UNKNOWN_ID, userId: host.id },
      { meetingId: 5 },
    ]) {
      const response = await asking(host, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const form = await request(app)
      .post(TICKETS)
      .set('Authorization', await host.bearer())
      .type('form')
      .send({ meetingId: UNKNOWN_ID });
    expect(form.status).toBe(415);
  });

  it('limits how often one user can ask, without affecting other users', async () => {
    const limited = createTestContext({
      rateLimits: { ...LENIENT_RATE_LIMITS, signaling: { windowMs: 60_000, limit: 2 } },
    });
    try {
      const [first, second] = (await createPeople(limited, ['Limited One', 'Limited Two'])) as [
        Person,
        Person,
      ];
      const meetingId = await scheduleMeeting(limited, first, [second]);
      const ask = async (person: Person) =>
        request(limited.app)
          .post(TICKETS)
          .set('Authorization', await person.bearer())
          .send({ meetingId });
      expect((await ask(first)).status).toBe(201);
      expect((await ask(first)).status).toBe(201);
      const blocked = await ask(first);
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect((await ask(second)).status).toBe(201);
    } finally {
      await clearAllTables(limited.pool);
      await limited.close();
    }
  });
});

describe('GET /ice-servers', () => {
  const ice = async (person?: Person) => {
    const call = request(app).get(ICE);
    return person ? call.set('Authorization', await person.bearer()) : call;
  };

  it('lists STUN, and TURN with credentials made for the user', async () => {
    const response = await ice(host);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.iceServers).toHaveLength(2);
    expect(response.body.iceServers[0]).toEqual({ urls: ['stun:stun.example:3478'] });
    const turn = response.body.iceServers[1];
    expect(turn.urls).toEqual(['turn:relay.example:3478']);
    expect(turn.username).toMatch(new RegExp(`^\\d+:${host.id}$`));
    expect(turn.credential).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('never reveals the shared secret', async () => {
    const response = await ice(host);
    expect(JSON.stringify(response.body)).not.toContain(TURN_SECRET);
  });

  it('gives different users different TURN credentials', async () => {
    const [a, b] = [await ice(host), await ice(guest)];
    expect(a.body.iceServers[1].credential).not.toBe(b.body.iceServers[1].credential);
    expect(a.body.iceServers[1].username).not.toBe(b.body.iceServers[1].username);
  });

  it('needs a valid access token', async () => {
    expect((await ice()).status).toBe(401);
  });

  it('uses time-limited credentials: they expire an hour after they were issued', async () => {
    const response = await ice(host);
    const expiry = Number(response.body.iceServers[1].username.split(':')[0]);
    expect(expiry).toBe(Math.floor(clock.current.getTime() / 1000) + 3600);
  });
});
