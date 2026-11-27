import type { CallType, MeetingStatus } from '../repositories/meetings.js';

export type { CallType, MeetingStatus };

export const JOIN_OPENS_MINUTES_BEFORE_START = 15;
export const MAX_INVITEES = 50;
export const MAX_DAYS_AHEAD = 365;
const CLOCK_SKEW_MS = 60 * 1000;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type Timing = { startsAt: Date; durationMinutes: number };
type TimedMeeting = Timing & { status: MeetingStatus };

export function endsAt(meeting: Timing): Date {
  return new Date(meeting.startsAt.getTime() + meeting.durationMinutes * MINUTE_MS);
}

/** A meeting is over from its end time on (the end instant itself already counts as over). */
export function isOver(meeting: Timing, now: Date): boolean {
  return now.getTime() >= endsAt(meeting).getTime();
}

/** Scheduled and not yet over: the meeting can still be cancelled or receive invitations. */
export function isActive(meeting: TimedMeeting, now: Date): boolean {
  return meeting.status === 'scheduled' && !isOver(meeting, now);
}

/**
 * Participants may join from 15 minutes before the start until the end (end excluded), while the
 * meeting is scheduled.
 */
export function isJoinable(meeting: TimedMeeting, now: Date): boolean {
  if (meeting.status !== 'scheduled') return false;
  const opensAt = meeting.startsAt.getTime() - JOIN_OPENS_MINUTES_BEFORE_START * MINUTE_MS;
  return now.getTime() >= opensAt && !isOver(meeting, now);
}

/** The host can edit a scheduled meeting only until it starts. */
export function isEditable(meeting: TimedMeeting, now: Date): boolean {
  return meeting.status === 'scheduled' && now.getTime() < meeting.startsAt.getTime();
}

/**
 * Checks a start time chosen by the user: not in the past (one minute of clock skew is tolerated)
 * and at most one year ahead. Returns the broken rule, or null when the time is acceptable.
 */
export function startsAtIssue(startsAt: Date, now: Date): 'in_the_past' | 'too_far_ahead' | null {
  if (startsAt.getTime() < now.getTime() - CLOCK_SKEW_MS) return 'in_the_past';
  if (startsAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * DAY_MS) return 'too_far_ahead';
  return null;
}
