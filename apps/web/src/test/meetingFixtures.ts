import type { Invitee, Meeting, MeetingList, MeetingSummary } from '../api/meetingsApi';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** An ISO time relative to now, so tests do not depend on the date they run on. */
export const inFuture = (ms: number): string => new Date(Date.now() + ms).toISOString();
export const hours = (n: number): number => n * HOUR_MS;
export const days = (n: number): number => n * DAY_MS;

export const HOST = { id: 'user-host', displayName: 'Hana Host' };
export const GUEST = { id: 'user-guest', displayName: 'Gus Guest' };

export function summary(overrides: Partial<MeetingSummary> = {}): MeetingSummary {
  return {
    id: 'meeting-1',
    title: 'Weekly sync',
    description: 'Agenda to follow',
    startsAt: inFuture(days(1)),
    durationMinutes: 60,
    callType: 'video',
    status: 'scheduled',
    role: 'host',
    host: HOST,
    inviteeCount: 0,
    ...overrides,
  };
}

export function meeting(overrides: Partial<Meeting> = {}): Meeting {
  const { inviteeCount: _unused, ...rest } = summary();
  return { ...rest, invitees: [], ...overrides };
}

export const invitee = (person = GUEST, email?: string): Invitee =>
  email === undefined ? person : { ...person, email };

export function list(items: MeetingSummary[], overrides: Partial<MeetingList> = {}): MeetingList {
  return { items, limit: 20, offset: 0, total: items.length, ...overrides };
}
