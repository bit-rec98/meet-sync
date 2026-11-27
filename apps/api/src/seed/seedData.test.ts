import { describe, expect, it } from 'vitest';
import { registerBodySchema } from '../http/schemas/auth.js';
import { isJoinable, isOver } from '../services/meetingRules.js';
import {
  BULK_MEETING_COUNT,
  SEED_PASSWORD,
  SEED_USERS,
  SEED_USER_KEYS,
  buildSeedMeetings,
} from './seedData.js';

const NOW = new Date('2026-12-01T15:00:30.500Z');
// Another moment, to show that the states follow "now" and not the day this file was written.
const LATER = new Date('2027-06-15T03:17:45.000Z');

const titled = (now: Date, prefix: string) =>
  buildSeedMeetings(now).filter((meeting) => meeting.title.startsWith(prefix));

describe('the test accounts', () => {
  it('are valid registrations under the API’s own rules (email, name and password policy)', () => {
    for (const user of SEED_USERS) {
      const result = registerBodySchema.safeParse({
        email: user.email,
        displayName: user.displayName,
        password: SEED_PASSWORD,
      });
      expect(result.success, user.email).toBe(true);
    }
  });

  it('use reserved @example.test addresses, one per key, with distinct names', () => {
    expect(SEED_USERS.map((user) => user.key)).toEqual([...SEED_USER_KEYS]);
    expect(SEED_USERS.every((user) => user.email.endsWith('@example.test'))).toBe(true);
    expect(new Set(SEED_USERS.map((user) => user.email)).size).toBe(SEED_USERS.length);
    expect(new Set(SEED_USERS.map((user) => user.displayName)).size).toBe(SEED_USERS.length);
  });
});

describe('the meetings', () => {
  it('have unique ids in the UUID format, and unique titles', () => {
    const meetings = buildSeedMeetings(NOW);
    expect(new Set(meetings.map((meeting) => meeting.id)).size).toBe(meetings.length);
    expect(new Set(meetings.map((meeting) => meeting.title)).size).toBe(meetings.length);
    for (const meeting of meetings) {
      expect(meeting.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('keep the same ids whenever they are built, so seeding again replaces them', () => {
    expect(buildSeedMeetings(NOW).map((meeting) => meeting.id)).toEqual(
      buildSeedMeetings(LATER).map((meeting) => meeting.id),
    );
  });

  it('only involve known people, never invite the host, and never invite anyone twice', () => {
    for (const meeting of buildSeedMeetings(NOW)) {
      expect(SEED_USER_KEYS, meeting.title).toContain(meeting.host);
      expect(meeting.invitees, meeting.title).not.toContain(meeting.host);
      expect(new Set(meeting.invitees).size, meeting.title).toBe(meeting.invitees.length);
      for (const invitee of meeting.invitees) expect(SEED_USER_KEYS).toContain(invitee);
    }
  });

  it('start on a whole minute', () => {
    for (const meeting of buildSeedMeetings(NOW)) {
      expect(meeting.startsAt.getTime() % 60_000, meeting.title).toBe(0);
    }
  });

  it.each([NOW, LATER])('are in the state their titles promise, at %s', (now) => {
    const joinableNow = titled(now, 'Joinable now');
    expect(joinableNow).toHaveLength(2);
    for (const meeting of joinableNow) {
      expect(isJoinable(meeting, now), meeting.title).toBe(true);
      expect(meeting.startsAt.getTime(), meeting.title).toBeGreaterThan(now.getTime()); // not started yet
    }

    const inProgress = titled(now, 'In progress');
    expect(inProgress).toHaveLength(1);
    expect(isJoinable(inProgress[0]!, now)).toBe(true);
    expect(inProgress[0]!.startsAt.getTime()).toBeLessThan(now.getTime());

    for (const meeting of titled(now, 'Later')) {
      expect(isJoinable(meeting, now), meeting.title).toBe(false);
      expect(isOver(meeting, now), meeting.title).toBe(false);
      expect(meeting.status).toBe('scheduled');
    }

    const finished = titled(now, 'Finished');
    expect(finished.map((meeting) => meeting.status).sort()).toEqual(['ended', 'scheduled']);
    for (const meeting of finished) {
      expect(isOver(meeting, now), meeting.title).toBe(true);
      expect(isJoinable(meeting, now), meeting.title).toBe(false);
    }

    const cancelled = titled(now, 'Cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.status).toBe('cancelled');
    expect(isJoinable(cancelled[0]!, now)).toBe(false);
  });

  it('include a video meeting with enough invitees to fill a call and then turn someone away', () => {
    const standUp = titled(NOW, 'Joinable now: team stand-up')[0]!;
    expect(standUp.callType).toBe('video');
    expect(standUp.invitees.length + 1).toBeGreaterThan(4); // the default limit for video calls
  });

  it('include an audio meeting that can be joined now', () => {
    expect(titled(NOW, 'Joinable now: check-in')[0]!.callType).toBe('audio');
  });

  it('keep one meeting that Ana is not part of, so she cannot see it', () => {
    const hidden = titled(NOW, 'Not for Ana')[0]!;
    expect(hidden.host).not.toBe('ana');
    expect(hidden.invitees).not.toContain('ana');
  });

  it('give Ana more upcoming meetings than fit on one page of 20', () => {
    const upcomingForAna = buildSeedMeetings(NOW).filter(
      (meeting) =>
        (meeting.host === 'ana' || meeting.invitees.includes('ana')) &&
        meeting.status === 'scheduled' &&
        !isOver(meeting, NOW),
    );
    expect(upcomingForAna.length).toBeGreaterThan(20);
    expect(
      upcomingForAna.filter((meeting) => meeting.title.startsWith('Sample meeting')),
    ).toHaveLength(BULK_MEETING_COUNT);
  });
});
