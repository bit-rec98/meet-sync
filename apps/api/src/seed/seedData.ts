import type { CallType, MeetingStatus } from '../repositories/meetings.js';

// Test data for local development. Everything here is public on purpose: the accounts exist only on
// a developer's own machine (the seed command refuses to run anywhere else), and `example.test` is a
// reserved name that can never receive email.

/** Shared by every seed account. Long enough for the password policy; worthless outside development. */
export const SEED_PASSWORD = 'meetsync-dev-password';

export type SeedUser = { key: SeedUserKey; email: string; displayName: string };

export const SEED_USER_KEYS = ['ana', 'ben', 'cleo', 'dan', 'eli'] as const;
export type SeedUserKey = (typeof SEED_USER_KEYS)[number];

export const SEED_USERS: readonly SeedUser[] = [
  { key: 'ana', email: 'ana@example.test', displayName: 'Ana García' },
  { key: 'ben', email: 'ben@example.test', displayName: 'Ben Brown' },
  { key: 'cleo', email: 'cleo@example.test', displayName: 'Cleo Cruz' },
  { key: 'dan', email: 'dan@example.test', displayName: 'Dan Díaz' },
  { key: 'eli', email: 'eli@example.test', displayName: 'Eli Evans' },
];

export type SeedMeeting = {
  /** A fixed id, so that seeding again replaces these meetings instead of adding more. */
  id: string;
  host: SeedUserKey;
  title: string;
  description: string | null;
  startsAt: Date;
  durationMinutes: number;
  callType: CallType;
  status: MeetingStatus;
  invitees: SeedUserKey[];
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Number of generated meetings that make Ana's list longer than one page (a page has 20). */
export const BULK_MEETING_COUNT = 22;

// Ids look like 5eed0000-0000-4000-8000-00000000000N ("seed"): valid UUIDs, easy to recognize.
const idFor = (number: number): string =>
  `5eed0000-0000-4000-8000-${String(number).padStart(12, '0')}`;

/**
 * The meetings, with every time relative to `now` so that each one is in the state its title says
 * whenever the seed runs. Times are rounded down to the minute to read well on screen.
 */
export function buildSeedMeetings(now: Date): SeedMeeting[] {
  const minute = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const at = (offsetMs: number): Date => new Date(minute + offsetMs);

  const meetings: SeedMeeting[] = [
    {
      id: idFor(1),
      host: 'ana',
      title: 'Joinable now: team stand-up (video)',
      description:
        'Starts in 10 minutes, so it can be joined already. Four invitees fill a video call.',
      startsAt: at(10 * MINUTE_MS),
      durationMinutes: 30,
      callType: 'video',
      status: 'scheduled',
      invitees: ['ben', 'cleo', 'dan', 'eli'],
    },
    {
      id: idFor(2),
      host: 'ben',
      title: 'Joinable now: check-in (audio)',
      description: 'Starts in 5 minutes. An audio call: no camera is offered.',
      startsAt: at(5 * MINUTE_MS),
      durationMinutes: 30,
      callType: 'audio',
      status: 'scheduled',
      invitees: ['ana', 'cleo', 'eli'],
    },
    {
      id: idFor(3),
      host: 'cleo',
      title: 'In progress: design review',
      description: 'Started 20 minutes ago and is still running; it can still be joined.',
      startsAt: at(-20 * MINUTE_MS),
      durationMinutes: 60,
      callType: 'video',
      status: 'scheduled',
      invitees: ['ana', 'ben'],
    },
    {
      id: idFor(4),
      host: 'ana',
      title: 'Later: quarterly planning',
      description: 'Two days away. The page says when joining opens.',
      startsAt: at(2 * DAY_MS),
      durationMinutes: 90,
      callType: 'video',
      status: 'scheduled',
      invitees: ['ben', 'cleo', 'dan'],
    },
    {
      id: idFor(5),
      host: 'ana',
      title: 'Later: lunch (nobody invited yet)',
      description: null,
      startsAt: at(1 * DAY_MS),
      durationMinutes: 45,
      callType: 'audio',
      status: 'scheduled',
      invitees: [],
    },
    {
      id: idFor(6),
      host: 'ana',
      title: 'Finished: retrospective',
      description: 'Ended an hour ago.',
      startsAt: at(-2 * HOUR_MS),
      durationMinutes: 60,
      callType: 'video',
      status: 'scheduled',
      invitees: ['ben', 'cleo'],
    },
    {
      id: idFor(7),
      host: 'ana',
      title: 'Finished: project kick-off (marked as ended)',
      description: null,
      startsAt: at(-3 * DAY_MS),
      durationMinutes: 60,
      callType: 'video',
      status: 'ended',
      invitees: ['ben'],
    },
    {
      id: idFor(8),
      host: 'ben',
      title: 'Cancelled: team offsite',
      description: 'Cancelled by the host; it cannot be joined.',
      startsAt: at(3 * DAY_MS),
      durationMinutes: 120,
      callType: 'video',
      status: 'cancelled',
      invitees: ['ana', 'cleo'],
    },
    {
      id: idFor(9),
      host: 'dan',
      title: 'Not for Ana: hiring sync',
      description:
        'Ana is not invited, so she cannot see it (the API answers as if it did not exist).',
      startsAt: at(1 * DAY_MS + 2 * HOUR_MS),
      durationMinutes: 30,
      callType: 'audio',
      status: 'scheduled',
      invitees: ['eli'],
    },
  ];

  // Enough extra upcoming meetings to need a second page in Ana's list.
  for (let index = 1; index <= BULK_MEETING_COUNT; index++) {
    meetings.push({
      id: idFor(100 + index),
      host: 'ana',
      title: `Sample meeting ${String(index).padStart(2, '0')}`,
      description: null,
      startsAt: at(3 * DAY_MS + index * HOUR_MS),
      durationMinutes: 30,
      callType: 'audio',
      status: 'scheduled',
      invitees: [],
    });
  }

  return meetings;
}
