import type { Pool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../errors.js';
import { clearAllTables, createTestPool } from '../test/database.js';
import { insertTestUser } from '../test/fixtures.js';
import type { UserRecord } from '../repositories/users.js';
import {
  createMeetingService,
  type MeetingDetail,
  type MeetingService,
  type NewMeeting,
} from './meetingService.js';
import { MAX_INVITEES } from './meetingRules.js';

const NOW = new Date('2026-12-01T12:00:00.000Z');
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const pool: Pool = createTestPool();
const clock = { current: NOW };
const service: MeetingService = createMeetingService({ pool, now: () => clock.current });

const setClock = (iso: string): void => {
  clock.current = new Date(iso);
};

/** Today at 15:00 UTC, one hour long, as in the rule tests. */
const meetingInput = (overrides: Partial<NewMeeting> = {}): NewMeeting => ({
  title: 'Weekly sync',
  description: 'Agenda to follow',
  startsAt: new Date('2026-12-01T15:00:00.000Z'),
  durationMinutes: 60,
  callType: 'video',
  ...overrides,
});

async function expectDomainError(
  promise: Promise<unknown>,
  code: string,
  details?: unknown,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code, ...(details ? { details } : {}) });
}

describe('meetingService', () => {
  let host: UserRecord;
  let guest: UserRecord;
  let stranger: UserRecord;

  /** A meeting hosted by `host`, with `guest` already invited unless told otherwise. */
  async function createMeeting(
    overrides: Partial<NewMeeting> = {},
    options: { inviteGuest?: boolean } = {},
  ): Promise<MeetingDetail> {
    const meeting = await service.create(host.id, meetingInput(overrides));
    if (options.inviteGuest ?? true) await service.addInvitee(host.id, meeting.id, guest.email);
    return meeting;
  }

  beforeEach(async () => {
    clock.current = NOW;
    await clearAllTables(pool);
    host = await insertTestUser(pool, { email: 'host@example.test', displayName: 'Hana Host' });
    guest = await insertTestUser(pool, { email: 'guest@example.test', displayName: 'Gus Guest' });
    stranger = await insertTestUser(pool, { email: 'stranger@example.test', displayName: 'Sam' });
  });
  afterAll(() => pool.end());

  describe('create', () => {
    it('creates a scheduled meeting hosted by the caller', async () => {
      const meeting = await service.create(host.id, meetingInput());
      expect(meeting).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        title: 'Weekly sync',
        description: 'Agenda to follow',
        startsAt: new Date('2026-12-01T15:00:00.000Z'),
        durationMinutes: 60,
        callType: 'video',
        status: 'scheduled',
        role: 'host',
        host: { id: host.id, displayName: 'Hana Host' },
        invitees: [],
      });
      expect(await service.get(host.id, meeting.id)).toEqual(meeting);
    });

    it('allows a missing description', async () => {
      const meeting = await service.create(host.id, meetingInput({ description: null }));
      expect(meeting.description).toBeNull();
    });

    it('rejects a start time in the past but tolerates one minute of clock skew', async () => {
      await expectDomainError(
        service.create(host.id, meetingInput({ startsAt: new Date(NOW.getTime() - 61 * 1000) })),
        'validation_error',
        [{ path: 'startsAt', code: 'in_the_past' }],
      );
      await expect(
        service.create(host.id, meetingInput({ startsAt: new Date(NOW.getTime() - 59 * 1000) })),
      ).resolves.toBeDefined();
    });

    it('rejects a start time more than a year ahead', async () => {
      await expectDomainError(
        service.create(host.id, meetingInput({ startsAt: new Date(NOW.getTime() + 366 * DAY_MS) })),
        'validation_error',
        [{ path: 'startsAt', code: 'too_far_ahead' }],
      );
    });
  });

  describe('get', () => {
    it('shows the host every invitee with their email', async () => {
      const meeting = await createMeeting();
      const seen = await service.get(host.id, meeting.id);
      expect(seen.role).toBe('host');
      expect(seen.invitees).toEqual([
        { id: guest.id, displayName: 'Gus Guest', email: 'guest@example.test' },
      ]);
    });

    it('shows an invitee the meeting without any email address', async () => {
      const meeting = await createMeeting();
      const seen = await service.get(guest.id, meeting.id);
      expect(seen.role).toBe('invitee');
      expect(seen.host).toEqual({ id: host.id, displayName: 'Hana Host' });
      expect(seen.invitees).toEqual([{ id: guest.id, displayName: 'Gus Guest' }]);
      expect(JSON.stringify(seen)).not.toContain('@example.test');
    });

    it('answers not_found alike for a stranger and for a meeting that does not exist', async () => {
      const meeting = await createMeeting();
      await expectDomainError(service.get(stranger.id, meeting.id), 'not_found');
      await expectDomainError(
        service.get(host.id, '00000000-0000-4000-8000-000000000000'),
        'not_found',
      );
    });
  });

  describe('list', () => {
    const list = (userId: string, when: 'upcoming' | 'past', limit = 20, offset = 0) =>
      service.list(userId, { when, limit, offset });

    it('returns meetings the user hosts or is invited to, and no others', async () => {
      const hosted = await createMeeting({ title: 'Hosted' }, { inviteGuest: false });
      const invited = await service.create(stranger.id, meetingInput({ title: 'Invited' }));
      await service.addInvitee(stranger.id, invited.id, host.email);
      await service.create(stranger.id, meetingInput({ title: 'Not mine' }));

      const result = await list(host.id, 'upcoming');
      expect(result.total).toBe(2);
      expect(result.items.map((item) => [item.title, item.role]).sort()).toEqual([
        ['Hosted', 'host'],
        ['Invited', 'invitee'],
      ]);
      expect(result.items.find((item) => item.id === hosted.id)?.host.displayName).toBe(
        'Hana Host',
      );
      expect(result.items.find((item) => item.id === invited.id)?.host.displayName).toBe('Sam');
    });

    it('counts invitees and does not include the invitee list or any email', async () => {
      await createMeeting();
      const { items } = await list(host.id, 'upcoming');
      expect(items[0]?.inviteeCount).toBe(1);
      expect(items[0]).not.toHaveProperty('invitees');
      expect(JSON.stringify(items)).not.toContain('@example.test');
    });

    it('sorts upcoming soonest first and past most recent first', async () => {
      const early = await service.create(
        host.id,
        meetingInput({ title: 'Early', startsAt: new Date('2026-12-01T13:00:00.000Z') }),
      );
      const middle = await service.create(
        host.id,
        meetingInput({ title: 'Middle', startsAt: new Date('2026-12-01T14:00:00.000Z') }),
      );
      const late = await service.create(
        host.id,
        meetingInput({ title: 'Late', startsAt: new Date('2026-12-05T14:00:00.000Z') }),
      );

      expect((await list(host.id, 'upcoming')).items.map((item) => item.id)).toEqual([
        early.id,
        middle.id,
        late.id,
      ]);

      setClock('2026-12-03T00:00:00.000Z'); // early and middle are over
      expect((await list(host.id, 'upcoming')).items.map((item) => item.id)).toEqual([late.id]);
      expect((await list(host.id, 'past')).items.map((item) => item.id)).toEqual([
        middle.id,
        early.id,
      ]);
    });

    it('keeps a meeting in upcoming while it runs and moves it to past at its end instant', async () => {
      const meeting = await createMeeting();
      setClock('2026-12-01T15:59:59.999Z');
      expect((await list(host.id, 'upcoming')).items.map((item) => item.id)).toEqual([meeting.id]);
      setClock('2026-12-01T16:00:00.000Z');
      expect((await list(host.id, 'upcoming')).total).toBe(0);
      expect((await list(host.id, 'past')).items.map((item) => item.id)).toEqual([meeting.id]);
    });

    it('puts cancelled meetings in past', async () => {
      const meeting = await createMeeting();
      await service.cancel(host.id, meeting.id);
      expect((await list(host.id, 'upcoming')).total).toBe(0);
      expect((await list(host.id, 'past')).items[0]).toMatchObject({
        id: meeting.id,
        status: 'cancelled',
      });
    });

    it('paginates and reports the total', async () => {
      for (let day = 1; day <= 5; day++) {
        await service.create(
          host.id,
          meetingInput({ title: `Day ${day}`, startsAt: new Date(NOW.getTime() + day * DAY_MS) }),
        );
      }
      const firstPage = await list(host.id, 'upcoming', 2, 0);
      const secondPage = await list(host.id, 'upcoming', 2, 2);
      const lastPage = await list(host.id, 'upcoming', 2, 4);
      expect(firstPage.total).toBe(5);
      expect(firstPage.items.map((item) => item.title)).toEqual(['Day 1', 'Day 2']);
      expect(secondPage.items.map((item) => item.title)).toEqual(['Day 3', 'Day 4']);
      expect(lastPage.items.map((item) => item.title)).toEqual(['Day 5']);
      expect((await list(host.id, 'upcoming', 2, 10)).items).toEqual([]);
    });

    it('lists nothing for a user without meetings', async () => {
      await createMeeting();
      expect(await list(stranger.id, 'upcoming')).toEqual({ items: [], total: 0 });
    });
  });

  describe('update', () => {
    it('changes only the provided fields and returns the updated meeting', async () => {
      const meeting = await createMeeting();
      const updated = await service.update(host.id, meeting.id, {
        title: 'Renamed',
        durationMinutes: 90,
      });
      expect(updated).toMatchObject({
        title: 'Renamed',
        durationMinutes: 90,
        description: 'Agenda to follow',
        callType: 'video',
        startsAt: meeting.startsAt,
      });
      expect(await service.get(host.id, meeting.id)).toEqual(updated);
    });

    it('can clear the description and change the call type and start time', async () => {
      const meeting = await createMeeting();
      const newStart = new Date('2026-12-02T10:00:00.000Z');
      const updated = await service.update(host.id, meeting.id, {
        description: null,
        callType: 'audio',
        startsAt: newStart,
      });
      expect(updated).toMatchObject({ description: null, callType: 'audio', startsAt: newStart });
    });

    it('does not let an invitee edit (forbidden) or a stranger see the meeting (not_found)', async () => {
      const meeting = await createMeeting();
      await expectDomainError(
        service.update(guest.id, meeting.id, { title: 'Hijacked' }),
        'forbidden',
      );
      await expectDomainError(
        service.update(stranger.id, meeting.id, { title: 'Hijacked' }),
        'not_found',
      );
      expect((await service.get(host.id, meeting.id)).title).toBe('Weekly sync');
    });

    it('refuses edits from the start time on, and for cancelled meetings', async () => {
      const meeting = await createMeeting();
      setClock('2026-12-01T14:59:59.999Z');
      await expect(
        service.update(host.id, meeting.id, { title: 'Last minute' }),
      ).resolves.toBeDefined();
      setClock('2026-12-01T15:00:00.000Z');
      await expectDomainError(
        service.update(host.id, meeting.id, { title: 'Too late' }),
        'invalid_state',
      );

      setClock('2026-12-01T12:00:00.000Z');
      await service.cancel(host.id, meeting.id);
      await expectDomainError(
        service.update(host.id, meeting.id, { title: 'Cancelled' }),
        'invalid_state',
      );
    });

    it('checks permission before state: an invitee gets forbidden even after the start', async () => {
      const meeting = await createMeeting();
      setClock('2026-12-01T15:30:00.000Z');
      await expectDomainError(service.update(guest.id, meeting.id, { title: 'x' }), 'forbidden');
    });

    it('applies the start-time rules to a new start time', async () => {
      const meeting = await createMeeting();
      await expectDomainError(
        service.update(host.id, meeting.id, { startsAt: new Date(NOW.getTime() - HOUR_MS) }),
        'validation_error',
        [{ path: 'startsAt', code: 'in_the_past' }],
      );
      expect((await service.get(host.id, meeting.id)).startsAt).toEqual(meeting.startsAt);
    });
  });

  describe('cancel', () => {
    it('cancels the meeting for host and invitees, and is idempotent', async () => {
      const meeting = await createMeeting();
      await service.cancel(host.id, meeting.id);
      await service.cancel(host.id, meeting.id);
      expect((await service.get(host.id, meeting.id)).status).toBe('cancelled');
      expect((await service.get(guest.id, meeting.id)).status).toBe('cancelled');
    });

    it('allows cancelling while the meeting is running but not once it is over', async () => {
      const running = await createMeeting();
      setClock('2026-12-01T15:30:00.000Z');
      await expect(service.cancel(host.id, running.id)).resolves.toBeUndefined();

      setClock('2026-12-01T12:00:00.000Z');
      const finished = await createMeeting({ title: 'Finished' });
      setClock('2026-12-01T16:00:00.000Z');
      await expectDomainError(service.cancel(host.id, finished.id), 'invalid_state');
    });

    it('does not let an invitee cancel (forbidden) or a stranger (not_found)', async () => {
      const meeting = await createMeeting();
      await expectDomainError(service.cancel(guest.id, meeting.id), 'forbidden');
      await expectDomainError(service.cancel(stranger.id, meeting.id), 'not_found');
      expect((await service.get(host.id, meeting.id)).status).toBe('scheduled');
    });
  });

  describe('addInvitee', () => {
    it('invites a registered user by email and gives them access', async () => {
      const meeting = await createMeeting({}, { inviteGuest: false });
      const invitee = await service.addInvitee(host.id, meeting.id, stranger.email);
      expect(invitee).toEqual({
        id: stranger.id,
        displayName: 'Sam',
        email: 'stranger@example.test',
      });
      expect((await service.get(stranger.id, meeting.id)).role).toBe('invitee');
    });

    it('reports an unknown email', async () => {
      const meeting = await createMeeting();
      await expectDomainError(
        service.addInvitee(host.id, meeting.id, 'nobody@example.test'),
        'user_not_found',
      );
    });

    it('rejects inviting the host and inviting someone twice', async () => {
      const meeting = await createMeeting();
      await expectDomainError(
        service.addInvitee(host.id, meeting.id, host.email),
        'already_invited',
      );
      await expectDomainError(
        service.addInvitee(host.id, meeting.id, guest.email),
        'already_invited',
      );
      expect((await service.get(host.id, meeting.id)).invitees).toHaveLength(1);
    });

    it('does not let an invitee invite (forbidden) or a stranger see the meeting (not_found)', async () => {
      const meeting = await createMeeting();
      await expectDomainError(
        service.addInvitee(guest.id, meeting.id, stranger.email),
        'forbidden',
      );
      await expectDomainError(
        service.addInvitee(stranger.id, meeting.id, stranger.email),
        'not_found',
      );
    });

    it('refuses invitations to cancelled meetings and to meetings that are over', async () => {
      const cancelled = await createMeeting({}, { inviteGuest: false });
      await service.cancel(host.id, cancelled.id);
      await expectDomainError(
        service.addInvitee(host.id, cancelled.id, guest.email),
        'invalid_state',
      );

      const finished = await createMeeting({ title: 'Finished' }, { inviteGuest: false });
      setClock('2026-12-01T16:00:00.000Z');
      await expectDomainError(
        service.addInvitee(host.id, finished.id, guest.email),
        'invalid_state',
      );
    });

    it('accepts exactly 50 invitees and refuses the 51st', async () => {
      const meeting = await createMeeting({}, { inviteGuest: false });
      for (let index = 0; index < MAX_INVITEES; index++) {
        const user = await insertTestUser(pool);
        await service.addInvitee(host.id, meeting.id, user.email);
      }
      expect((await service.get(host.id, meeting.id)).invitees).toHaveLength(MAX_INVITEES);

      await expectDomainError(
        service.addInvitee(host.id, meeting.id, guest.email),
        'invitee_limit_reached',
      );
      expect((await service.get(host.id, meeting.id)).invitees).toHaveLength(MAX_INVITEES);
    });

    it('reports an existing invitee as already invited even when the meeting is full', async () => {
      const meeting = await createMeeting();
      for (let index = 0; index < MAX_INVITEES - 1; index++) {
        await service.addInvitee(host.id, meeting.id, (await insertTestUser(pool)).email);
      }
      await expectDomainError(
        service.addInvitee(host.id, meeting.id, guest.email),
        'already_invited',
      );
    });

    it('never exceeds the limit when two invitations race for the last place', async () => {
      const meeting = await createMeeting({}, { inviteGuest: false });
      for (let index = 0; index < MAX_INVITEES - 1; index++) {
        await service.addInvitee(host.id, meeting.id, (await insertTestUser(pool)).email);
      }
      const results = await Promise.allSettled([
        service.addInvitee(host.id, meeting.id, guest.email),
        service.addInvitee(host.id, meeting.id, stranger.email),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((result) => result.status === 'rejected');
      expect(failure?.status === 'rejected' && failure.reason).toMatchObject({
        code: 'invitee_limit_reached',
      });
      expect((await service.get(host.id, meeting.id)).invitees).toHaveLength(MAX_INVITEES);
    });
  });

  describe('removeInvitee', () => {
    it('lets the host remove an invitee, who then loses access', async () => {
      const meeting = await createMeeting();
      await service.removeInvitee(host.id, meeting.id, guest.id);
      await expectDomainError(service.get(guest.id, meeting.id), 'not_found');
      expect((await service.get(host.id, meeting.id)).invitees).toEqual([]);
    });

    it('lets an invitee remove only themselves', async () => {
      const meeting = await createMeeting();
      await service.addInvitee(host.id, meeting.id, stranger.email);
      await expectDomainError(
        service.removeInvitee(guest.id, meeting.id, stranger.id),
        'forbidden',
      );
      await expectDomainError(service.removeInvitee(guest.id, meeting.id, host.id), 'forbidden');

      await service.removeInvitee(guest.id, meeting.id, guest.id);
      await expectDomainError(service.get(guest.id, meeting.id), 'not_found');
      expect(
        (await service.get(host.id, meeting.id)).invitees.map((invitee) => invitee.id),
      ).toEqual([stranger.id]);
    });

    it('answers not_found to a stranger, and for someone who is not an invitee', async () => {
      const meeting = await createMeeting();
      await expectDomainError(
        service.removeInvitee(stranger.id, meeting.id, guest.id),
        'not_found',
      );
      await expectDomainError(service.removeInvitee(host.id, meeting.id, stranger.id), 'not_found');
      await expectDomainError(service.removeInvitee(host.id, meeting.id, host.id), 'not_found');
      expect((await service.get(host.id, meeting.id)).invitees).toHaveLength(1);
    });

    it('answers not_found when the invitee was already removed', async () => {
      const meeting = await createMeeting();
      await service.removeInvitee(host.id, meeting.id, guest.id);
      await expectDomainError(service.removeInvitee(host.id, meeting.id, guest.id), 'not_found');
    });

    it('still works once the meeting is over, so people can tidy their lists', async () => {
      const meeting = await createMeeting();
      setClock('2026-12-02T00:00:00.000Z');
      await expect(service.removeInvitee(guest.id, meeting.id, guest.id)).resolves.toBeUndefined();
    });
  });

  describe('assertCanJoin', () => {
    it('opens 15 minutes before the start and closes at the end instant', async () => {
      const meeting = await createMeeting();
      const joinable = (userId: string) => service.assertCanJoin(userId, meeting.id);

      setClock('2026-12-01T14:44:59.999Z');
      await expectDomainError(joinable(host.id), 'invalid_state');
      setClock('2026-12-01T14:45:00.000Z');
      await expect(joinable(host.id)).resolves.toMatchObject({ id: meeting.id, role: 'host' });
      await expect(joinable(guest.id)).resolves.toMatchObject({
        id: meeting.id,
        role: 'invitee',
        callType: 'video',
      });
      setClock('2026-12-01T15:59:59.999Z');
      await expect(joinable(guest.id)).resolves.toBeDefined();
      setClock('2026-12-01T16:00:00.000Z');
      await expectDomainError(joinable(guest.id), 'invalid_state');
    });

    it('refuses cancelled meetings and treats strangers like the meeting does not exist', async () => {
      const meeting = await createMeeting();
      setClock('2026-12-01T15:10:00.000Z');
      await expectDomainError(service.assertCanJoin(stranger.id, meeting.id), 'not_found');
      await service.cancel(host.id, meeting.id);
      await expectDomainError(service.assertCanJoin(host.id, meeting.id), 'invalid_state');
    });

    it('refuses an invitee who was removed', async () => {
      const meeting = await createMeeting();
      setClock('2026-12-01T15:10:00.000Z');
      await service.removeInvitee(host.id, meeting.id, guest.id);
      await expectDomainError(service.assertCanJoin(guest.id, meeting.id), 'not_found');
    });
  });
});
