import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { findUserByEmail, type UserRecord } from '../repositories/users.js';
import { createTestContext } from '../test/app.js';
import { clearAllTables } from '../test/database.js';
import { accessTokenFor, insertTestUser } from '../test/fixtures.js';
import { scheduleMeeting } from '../test/scenario.js';
import { removeSeedData, seedDatabase } from './seed.js';
import { BULK_MEETING_COUNT, SEED_PASSWORD, SEED_USERS, buildSeedMeetings } from './seedData.js';

const context = createTestContext();
const { app, pool } = context;

// A fast stand-in for password hashing in tests that do not log in.
const quickHash = async (password: string): Promise<string> => `quick-hash:${password.length}`;
const seed = () => seedDatabase(pool, { hash: quickHash });

const MEETING_COUNT = BULK_MEETING_COUNT + 9;

async function count(table: string, where = '1 = 1', params: unknown[] = []): Promise<number> {
  const [rows] = await pool.query<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`,
    params,
  );
  return Number(rows[0]?.n);
}

async function userByEmail(email: string): Promise<UserRecord> {
  const user = await findUserByEmail(pool, email);
  if (!user) throw new Error(`No user ${email}`);
  return user;
}

function seedMeetingId(titlePrefix: string): string {
  const found = buildSeedMeetings(new Date()).find((meeting) =>
    meeting.title.startsWith(titlePrefix),
  );
  if (!found) throw new Error(`No seed meeting starts with "${titlePrefix}"`);
  return found.id;
}

const bearerFor = async (user: UserRecord): Promise<string> =>
  `Bearer ${await accessTokenFor(user.id, context.config.accessTokenSecret, context.clock.current)}`;

beforeEach(() => clearAllTables(pool));
afterAll(() => context.close());

describe('seedDatabase', () => {
  it('creates the accounts, the meetings and their invitations', async () => {
    const expectedInvitations = buildSeedMeetings(new Date()).reduce(
      (sum, meeting) => sum + meeting.invitees.length,
      0,
    );
    expect(await seed()).toEqual({
      users: 5,
      meetings: MEETING_COUNT,
      invitations: expectedInvitations,
    });
    expect(await count('users')).toBe(5);
    expect(await count('meetings')).toBe(MEETING_COUNT);
    expect(await count('meeting_invitees')).toBe(expectedInvitations);
  });

  it('can be run again without duplicating anything, and keeps the accounts’ ids', async () => {
    await seed();
    const idsBefore = await Promise.all(
      SEED_USERS.map(async (user) => (await userByEmail(user.email)).id),
    );
    await seed();
    const idsAfter = await Promise.all(
      SEED_USERS.map(async (user) => (await userByEmail(user.email)).id),
    );

    expect(await count('users')).toBe(5);
    expect(await count('meetings')).toBe(MEETING_COUNT);
    expect(idsAfter).toEqual(idsBefore);
  });

  it('gives the meetings new times when run again later', async () => {
    await seedDatabase(pool, { hash: quickHash, now: new Date('2026-12-01T10:00:00.000Z') });
    await seedDatabase(pool, { hash: quickHash, now: new Date('2026-12-05T18:30:00.000Z') });

    const [rows] = await pool.query<(RowDataPacket & { starts_at: Date })[]>(
      'SELECT starts_at FROM meetings WHERE id = ?',
      [seedMeetingId('Joinable now: team stand-up')],
    );
    expect(rows[0]?.starts_at.toISOString()).toBe('2026-12-05T18:40:00.000Z'); // second run + 10 minutes
  });

  it('resets the password and name of an account that already exists, keeping its id', async () => {
    const existing = await insertTestUser(pool, {
      email: 'ana@example.test',
      displayName: 'Someone Else',
    });
    await seed();

    const ana = await userByEmail('ana@example.test');
    expect(await count('users', 'email = ?', ['ana@example.test'])).toBe(1);
    expect(ana.id).toBe(existing.id);
    expect(ana.displayName).toBe('Ana García');
    expect(ana.passwordHash).toBe(await quickHash(SEED_PASSWORD));
  });

  it('leaves other people and their meetings alone', async () => {
    const other = await insertTestUser(pool);
    const handmade = await scheduleMeeting(context, other, []);
    await seed();
    await seed();
    expect(await count('users')).toBe(6);
    expect(await count('meetings', 'id = ?', [handmade])).toBe(1);
  });

  it('writes nothing when it fails part-way', async () => {
    // A pool whose third invitation fails, after the accounts and meetings were already written.
    let invitations = 0;
    const failing = new Proxy(pool, {
      get(target, property, receiver) {
        if (property !== 'getConnection') return Reflect.get(target, property, receiver) as unknown;
        return async () => {
          const connection = await target.getConnection();
          const execute = connection.execute.bind(connection) as (...args: unknown[]) => unknown;
          (connection as unknown as { execute: unknown }).execute = (
            sql: string,
            ...rest: unknown[]
          ) => {
            if (sql.includes('INSERT INTO meeting_invitees') && ++invitations === 3) {
              throw new Error('simulated failure');
            }
            return execute(sql, ...rest);
          };
          return connection;
        };
      },
    }) as Pool;

    await expect(seedDatabase(failing, { hash: quickHash })).rejects.toThrow('simulated failure');
    expect(invitations).toBe(3);
    expect(await count('users')).toBe(0);
    expect(await count('meetings')).toBe(0);
    expect(await count('meeting_invitees')).toBe(0);
  });
});

describe('the seeded data, through the API', () => {
  it('lets every test account log in with the shared password, and nobody with another one', async () => {
    await seedDatabase(pool); // with real password hashing
    for (const user of SEED_USERS) {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: SEED_PASSWORD });
      expect(response.status, user.email).toBe(200);
    }
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ana@example.test', password: 'not-the-password' });
    expect(wrong.status).toBe(401);
  });

  it('gives Ana a full first page and a second page, and keeps the other meeting hidden from her', async () => {
    await seed();
    const authorization = await bearerFor(await userByEmail('ana@example.test'));
    const page = (offset: number) =>
      request(app)
        .get(`/api/v1/meetings?when=upcoming&limit=20&offset=${offset}`)
        .set('Authorization', authorization);

    const first = await page(0);
    const second = await page(20);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.total).toBeGreaterThan(20);
    expect(second.body.items.length).toBeGreaterThan(0);

    const hidden = await request(app)
      .get(`/api/v1/meetings/${seedMeetingId('Not for Ana')}`)
      .set('Authorization', authorization);
    expect(hidden.status).toBe(404);
  });

  it('lets people get a call ticket exactly when the titles say they can', async () => {
    await seed();
    const ticketStatus = async (email: string, titlePrefix: string): Promise<number> =>
      (
        await request(app)
          .post('/api/v1/ws-tickets')
          .set('Authorization', await bearerFor(await userByEmail(email)))
          .send({ meetingId: seedMeetingId(titlePrefix) })
      ).status;

    expect(await ticketStatus('ben@example.test', 'Joinable now: team stand-up')).toBe(201);
    expect(await ticketStatus('eli@example.test', 'Joinable now: team stand-up')).toBe(201);
    expect(await ticketStatus('ana@example.test', 'Joinable now: check-in')).toBe(201);
    expect(await ticketStatus('ana@example.test', 'In progress')).toBe(201);
    expect(await ticketStatus('ben@example.test', 'Later: quarterly planning')).toBe(409);
    expect(await ticketStatus('ana@example.test', 'Finished: retrospective')).toBe(409);
    expect(await ticketStatus('ana@example.test', 'Cancelled')).toBe(409);
    expect(await ticketStatus('ana@example.test', 'Not for Ana')).toBe(404);
  });
});

describe('removeSeedData', () => {
  it('deletes the accounts and every meeting they host', async () => {
    await seed();
    expect(await removeSeedData(pool)).toEqual({ users: 5, meetings: MEETING_COUNT });
    expect(await count('users')).toBe(0);
    expect(await count('meetings')).toBe(0);
    expect(await count('meeting_invitees')).toBe(0);
  });

  it('also deletes meetings made by hand by these accounts, which could not outlive their host', async () => {
    await seed();
    await scheduleMeeting(context, await userByEmail('ana@example.test'), []);
    expect((await removeSeedData(pool)).meetings).toBe(MEETING_COUNT + 1);
  });

  it('leaves other people and their meetings, but drops these accounts’ invitations to them', async () => {
    const other = await insertTestUser(pool);
    await seed();
    const theirs = await scheduleMeeting(context, other, [await userByEmail('ben@example.test')]);
    expect(await count('meeting_invitees', 'meeting_id = ?', [theirs])).toBe(1);

    await removeSeedData(pool);
    expect(await count('users')).toBe(1);
    expect(await count('meetings', 'id = ?', [theirs])).toBe(1);
    expect(await count('meeting_invitees', 'meeting_id = ?', [theirs])).toBe(0);
  });

  it('does nothing when there is nothing to remove, and can be repeated', async () => {
    expect(await removeSeedData(pool)).toEqual({ users: 0, meetings: 0 });
    await seed();
    await removeSeedData(pool);
    expect(await removeSeedData(pool)).toEqual({ users: 0, meetings: 0 });
  });

  it('can be followed by seeding again', async () => {
    await seed();
    await removeSeedData(pool);
    expect((await seed()).users).toBe(5);
    expect(await count('meetings')).toBe(MEETING_COUNT);
  });
});
