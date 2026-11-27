import type { MeetingStatus } from '../api/meetingsApi';

const MINUTE_MS = 60 * 1000;

type Timed = { startsAt: string; durationMinutes: number; status: MeetingStatus };

export type MeetingTiming = 'cancelled' | 'ended' | 'upcoming' | 'inProgress' | 'over';

const startMs = (meeting: Timed): number => new Date(meeting.startsAt).getTime();
const endMs = (meeting: Timed): number => startMs(meeting) + meeting.durationMinutes * MINUTE_MS;

// The rules below mirror the API's, only to decide which buttons to offer. The API stays the
// authority: if the page is stale, its refusal is shown to the user as a message.

/** Where the meeting stands relative to `now`. The end instant itself already counts as over. */
export function meetingTiming(meeting: Timed, now: Date): MeetingTiming {
  if (meeting.status === 'cancelled') return 'cancelled';
  if (meeting.status === 'ended') return 'ended';
  if (now.getTime() < startMs(meeting)) return 'upcoming';
  return now.getTime() < endMs(meeting) ? 'inProgress' : 'over';
}

/** The host can edit a scheduled meeting only until it starts. */
export function canEdit(meeting: Timed, now: Date): boolean {
  return meeting.status === 'scheduled' && now.getTime() < startMs(meeting);
}

/** People can join a call from this many minutes before the start. */
export const JOIN_OPENS_MINUTES_BEFORE_START = 15;

/** When the join window opens. */
export function joinOpensAt(meeting: Timed): Date {
  return new Date(startMs(meeting) - JOIN_OPENS_MINUTES_BEFORE_START * MINUTE_MS);
}

/**
 * Whether a call can be joined now: a scheduled meeting, from 15 minutes before its start until its
 * end (the end instant excluded). The API applies the same rule and stays the authority.
 */
export function canJoin(meeting: Timed, now: Date): boolean {
  return (
    meeting.status === 'scheduled' &&
    now.getTime() >= joinOpensAt(meeting).getTime() &&
    now.getTime() < endMs(meeting)
  );
}

/** Scheduled and not over: it can still be cancelled and receive invitations. */
export function isActive(meeting: Timed, now: Date): boolean {
  return meeting.status === 'scheduled' && now.getTime() < endMs(meeting);
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** The value for an `<input type="datetime-local">`: the instant in the user's own time zone. */
export function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const LOCAL_INPUT_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * Turns what the user typed in a datetime-local input (their local time, no zone) into an ISO
 * instant in UTC. Returns null when it is not a real date and time (for example February 31).
 */
export function fromLocalInputValue(value: string): string | null {
  if (!LOCAL_INPUT_SHAPE.test(value)) return null;
  const date = new Date(value); // a date-time without a zone is read as local time
  if (Number.isNaN(date.getTime())) return null;
  // Dates such as 2026-02-31 are "corrected" by the Date constructor; refuse them.
  if (toLocalInputValue(date.toISOString()) !== value.slice(0, 16)) return null;
  return date.toISOString();
}

export type DateTimeStyle = 'short' | 'long';

/** The instant in the user's time zone and the interface language. */
export function formatDateTime(iso: string, language: string, style: DateTimeStyle): string {
  const formatter = new Intl.DateTimeFormat(
    language,
    style === 'long'
      ? { dateStyle: 'full', timeStyle: 'short' }
      : { dateStyle: 'medium', timeStyle: 'short' },
  );
  return formatter.format(new Date(iso));
}

/** The next whole hour (in any zone with whole-hour offsets), or `now` itself when it is one. */
export function nextFullHour(now: Date): Date {
  const hour = 60 * MINUTE_MS;
  return new Date(Math.ceil(now.getTime() / hour) * hour);
}

export function userTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function durationParts(totalMinutes: number): { hours: number; minutes: number } {
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}
