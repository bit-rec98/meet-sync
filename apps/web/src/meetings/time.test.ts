import { describe, expect, it } from 'vitest';
import type { MeetingStatus } from '../api/meetingsApi';
import {
  canEdit,
  canJoin,
  joinOpensAt,
  durationParts,
  formatDateTime,
  fromLocalInputValue,
  isActive,
  meetingTiming,
  nextFullHour,
  toLocalInputValue,
  userTimeZone,
} from './time';

const meeting = (status: MeetingStatus = 'scheduled') => ({
  startsAt: '2026-12-01T15:00:00.000Z',
  durationMinutes: 60,
  status,
});
const at = (iso: string): Date => new Date(iso);

describe('test environment', () => {
  it('runs in Buenos Aires time (UTC-3), so UTC/local mix-ups cannot pass unnoticed', () => {
    // The zone's name differs between ICU versions (an alias is also reported), so check the offset.
    expect(userTimeZone()).toMatch(/Buenos_Aires/);
    for (const iso of ['2026-12-01T15:00:00Z', '2026-06-15T15:00:00Z']) {
      expect(new Date(iso).getTimezoneOffset()).toBe(180); // UTC-3 all year, no daylight saving
      expect(new Date(iso).getHours()).toBe(12);
    }
  });
});

describe('local input values', () => {
  it('shows an instant in the user’s own time zone', () => {
    expect(toLocalInputValue('2026-12-01T15:00:00.000Z')).toBe('2026-12-01T12:00');
  });

  it('follows the local calendar across midnight', () => {
    expect(toLocalInputValue('2026-12-01T01:30:00.000Z')).toBe('2026-11-30T22:30');
    expect(toLocalInputValue('2026-12-31T23:59:00.000Z')).toBe('2026-12-31T20:59');
    expect(toLocalInputValue('2027-01-01T03:00:00.000Z')).toBe('2027-01-01T00:00');
  });

  it('turns what the user typed (local time) into UTC', () => {
    expect(fromLocalInputValue('2026-12-01T12:00')).toBe('2026-12-01T15:00:00.000Z');
    expect(fromLocalInputValue('2026-12-01T22:30')).toBe('2026-12-02T01:30:00.000Z');
    expect(fromLocalInputValue('2026-12-01T12:00:30')).toBe('2026-12-01T15:00:30.000Z');
  });

  it('round-trips without drifting', () => {
    for (const iso of [
      '2026-12-01T15:00:00.000Z',
      '2026-06-15T03:45:00.000Z',
      '2027-03-01T00:00:00.000Z',
    ]) {
      expect(fromLocalInputValue(toLocalInputValue(iso))).toBe(iso);
    }
  });

  it('rejects text that is not a real date and time', () => {
    for (const value of [
      '',
      'tomorrow',
      '2026-12-01',
      '2026-12-01 12:00',
      '2026-02-31T10:00',
      '2026-13-01T10:00',
      '2026-12-01T25:00',
      '2026-12-01T12:60',
    ]) {
      expect(fromLocalInputValue(value), value).toBeNull();
    }
  });
});

describe('meetingTiming', () => {
  it('is upcoming before the start, in progress during, and over from the end instant', () => {
    expect(meetingTiming(meeting(), at('2026-12-01T14:59:59.999Z'))).toBe('upcoming');
    expect(meetingTiming(meeting(), at('2026-12-01T15:00:00.000Z'))).toBe('inProgress');
    expect(meetingTiming(meeting(), at('2026-12-01T15:59:59.999Z'))).toBe('inProgress');
    expect(meetingTiming(meeting(), at('2026-12-01T16:00:00.000Z'))).toBe('over');
  });

  it('reports cancelled and ended meetings whatever the time', () => {
    expect(meetingTiming(meeting('cancelled'), at('2026-12-01T15:30:00.000Z'))).toBe('cancelled');
    expect(meetingTiming(meeting('ended'), at('2026-11-01T00:00:00.000Z'))).toBe('ended');
  });
});

describe('what the host may still do', () => {
  it('can edit only before the start of a scheduled meeting', () => {
    expect(canEdit(meeting(), at('2026-12-01T14:59:59.999Z'))).toBe(true);
    expect(canEdit(meeting(), at('2026-12-01T15:00:00.000Z'))).toBe(false);
    expect(canEdit(meeting('cancelled'), at('2026-11-01T00:00:00.000Z'))).toBe(false);
  });

  it('can cancel and invite until the end, but not afterwards or when cancelled', () => {
    expect(isActive(meeting(), at('2026-12-01T15:59:59.999Z'))).toBe(true);
    expect(isActive(meeting(), at('2026-12-01T16:00:00.000Z'))).toBe(false);
    expect(isActive(meeting('cancelled'), at('2026-11-01T00:00:00.000Z'))).toBe(false);
    expect(isActive(meeting('ended'), at('2026-11-01T00:00:00.000Z'))).toBe(false);
  });
});

describe('canJoin', () => {
  it('opens exactly 15 minutes before the start', () => {
    expect(joinOpensAt(meeting()).toISOString()).toBe('2026-12-01T14:45:00.000Z');
    expect(canJoin(meeting(), at('2026-12-01T14:44:59.999Z'))).toBe(false);
    expect(canJoin(meeting(), at('2026-12-01T14:45:00.000Z'))).toBe(true);
  });

  it('stays open during the meeting and closes at the end instant', () => {
    expect(canJoin(meeting(), at('2026-12-01T15:30:00.000Z'))).toBe(true);
    expect(canJoin(meeting(), at('2026-12-01T15:59:59.999Z'))).toBe(true);
    expect(canJoin(meeting(), at('2026-12-01T16:00:00.000Z'))).toBe(false);
  });

  it('is never open for cancelled or ended meetings', () => {
    for (const status of ['cancelled', 'ended'] as const) {
      expect(canJoin(meeting(status), at('2026-12-01T15:30:00.000Z'))).toBe(false);
    }
  });
});

describe('formatting', () => {
  it('shows the user’s local time in the chosen language', () => {
    const english = formatDateTime('2026-12-01T15:00:00.000Z', 'en', 'long');
    expect(english).toContain('December');
    expect(english).toContain('12:00');
    const spanish = formatDateTime('2026-12-01T15:00:00.000Z', 'es', 'long');
    expect(spanish).toContain('diciembre');
    expect(spanish).toContain('12:00');
  });

  it('has a shorter form for lists', () => {
    expect(formatDateTime('2026-12-01T15:00:00.000Z', 'en', 'short')).toContain('Dec 1, 2026');
  });

  it('proposes the next whole hour as a default start', () => {
    expect(nextFullHour(at('2026-12-01T15:00:00.000Z')).toISOString()).toBe(
      '2026-12-01T15:00:00.000Z',
    );
    expect(nextFullHour(at('2026-12-01T15:00:00.001Z')).toISOString()).toBe(
      '2026-12-01T16:00:00.000Z',
    );
    expect(nextFullHour(at('2026-12-01T15:59:59.999Z')).toISOString()).toBe(
      '2026-12-01T16:00:00.000Z',
    );
    expect(toLocalInputValue(nextFullHour(at('2026-12-01T15:20:00.000Z')).toISOString())).toBe(
      '2026-12-01T13:00',
    );
  });

  it('splits durations into hours and minutes', () => {
    expect(durationParts(45)).toEqual({ hours: 0, minutes: 45 });
    expect(durationParts(60)).toEqual({ hours: 1, minutes: 0 });
    expect(durationParts(135)).toEqual({ hours: 2, minutes: 15 });
    expect(durationParts(480)).toEqual({ hours: 8, minutes: 0 });
  });
});
