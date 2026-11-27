import { describe, expect, it } from 'vitest';
import {
  endsAt,
  isActive,
  isEditable,
  isJoinable,
  isOver,
  startsAtIssue,
  type MeetingStatus,
} from './meetingRules.js';

const STARTS_AT = new Date('2026-12-01T15:00:00.000Z');
const meeting = (status: MeetingStatus = 'scheduled') => ({
  startsAt: STARTS_AT,
  durationMinutes: 60,
  status,
});
const at = (iso: string): Date => new Date(iso);

describe('endsAt and isOver', () => {
  it('ends at the start plus the duration', () => {
    expect(endsAt(meeting()).toISOString()).toBe('2026-12-01T16:00:00.000Z');
  });

  it('is over from the end instant on', () => {
    expect(isOver(meeting(), at('2026-12-01T15:59:59.999Z'))).toBe(false);
    expect(isOver(meeting(), at('2026-12-01T16:00:00.000Z'))).toBe(true);
  });
});

describe('isJoinable', () => {
  it('opens exactly 15 minutes before the start', () => {
    expect(isJoinable(meeting(), at('2026-12-01T14:44:59.999Z'))).toBe(false);
    expect(isJoinable(meeting(), at('2026-12-01T14:45:00.000Z'))).toBe(true);
  });

  it('stays open during the meeting and closes at the end instant', () => {
    expect(isJoinable(meeting(), at('2026-12-01T15:00:00.000Z'))).toBe(true);
    expect(isJoinable(meeting(), at('2026-12-01T15:59:59.999Z'))).toBe(true);
    expect(isJoinable(meeting(), at('2026-12-01T16:00:00.000Z'))).toBe(false);
  });

  it('is never joinable when cancelled or ended', () => {
    for (const status of ['cancelled', 'ended'] as const) {
      expect(isJoinable(meeting(status), at('2026-12-01T15:30:00.000Z'))).toBe(false);
    }
  });
});

describe('isEditable', () => {
  it('allows edits until the start instant', () => {
    expect(isEditable(meeting(), at('2026-12-01T14:59:59.999Z'))).toBe(true);
    expect(isEditable(meeting(), at('2026-12-01T15:00:00.000Z'))).toBe(false);
  });

  it('does not allow edits when cancelled or ended', () => {
    expect(isEditable(meeting('cancelled'), at('2026-11-30T00:00:00.000Z'))).toBe(false);
    expect(isEditable(meeting('ended'), at('2026-11-30T00:00:00.000Z'))).toBe(false);
  });
});

describe('isActive', () => {
  it('is true for a scheduled meeting that is not over yet, including while it runs', () => {
    expect(isActive(meeting(), at('2026-11-01T00:00:00.000Z'))).toBe(true);
    expect(isActive(meeting(), at('2026-12-01T15:30:00.000Z'))).toBe(true);
  });

  it('is false once over, cancelled, or ended', () => {
    expect(isActive(meeting(), at('2026-12-01T16:00:00.000Z'))).toBe(false);
    expect(isActive(meeting('cancelled'), at('2026-11-01T00:00:00.000Z'))).toBe(false);
    expect(isActive(meeting('ended'), at('2026-11-01T00:00:00.000Z'))).toBe(false);
  });
});

describe('startsAtIssue', () => {
  const now = at('2026-12-01T12:00:00.000Z');

  it('tolerates one minute of clock skew into the past', () => {
    expect(startsAtIssue(at('2026-12-01T11:59:00.000Z'), now)).toBeNull();
    expect(startsAtIssue(at('2026-12-01T11:58:59.999Z'), now)).toBe('in_the_past');
  });

  it('accepts times up to one year ahead and rejects later ones', () => {
    expect(startsAtIssue(at('2027-12-01T12:00:00.000Z'), now)).toBeNull();
    expect(startsAtIssue(at('2027-12-01T12:00:00.001Z'), now)).toBe('too_far_ahead');
  });

  it('accepts a time right now and in the near future', () => {
    expect(startsAtIssue(now, now)).toBeNull();
    expect(startsAtIssue(at('2026-12-02T09:00:00.000Z'), now)).toBeNull();
  });
});
