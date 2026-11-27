import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { meeting } from '../test/meetingFixtures';
import {
  describeActionFailure,
  describeLoadFailure,
  describeMeetingFailure,
} from './meetingErrors';
import {
  changesBetween,
  problemFromMeetingIssue,
  toMeetingInput,
  validateDescription,
  validateDuration,
  validateStartsAt,
  validateTitle,
  valuesFromMeeting,
} from './meetingValidation';

// 2026-12-01 12:00 in Buenos Aires (UTC-3) is 15:00 UTC.
const NOW = new Date('2026-12-01T15:00:00.000Z');
const failure = (code: ConstructorParameters<typeof ApiError>[0]['code'], details = []) =>
  new ApiError({ status: 400, code, details });

describe('validateTitle', () => {
  it('requires 1 to 120 characters after trimming', () => {
    expect(validateTitle('')).toEqual({ key: 'titleRequired' });
    expect(validateTitle('   ')).toEqual({ key: 'titleRequired' });
    expect(validateTitle('a')).toBeNull();
    expect(validateTitle(`  ${'a'.repeat(120)}  `)).toBeNull();
    expect(validateTitle('a'.repeat(121))).toEqual({ key: 'titleTooLong', values: { max: 120 } });
  });
});

describe('validateDescription', () => {
  it('allows empty text and up to 2000 characters', () => {
    expect(validateDescription('')).toBeNull();
    expect(validateDescription('a'.repeat(2000))).toBeNull();
    expect(validateDescription('a'.repeat(2001))).toEqual({
      key: 'descriptionTooLong',
      values: { max: 2000 },
    });
  });
});

describe('validateStartsAt', () => {
  it('asks for a date and rejects text that is not a real date and time', () => {
    expect(validateStartsAt('', NOW)).toEqual({ key: 'startsAtRequired' });
    for (const value of ['tomorrow', '2026-02-31T10:00', '2026-12-01']) {
      expect(validateStartsAt(value, NOW), value).toEqual({ key: 'startsAtInvalid' });
    }
  });

  it('judges the time the user typed in their own time zone, with a minute of tolerance', () => {
    expect(validateStartsAt('2026-12-01T12:00', NOW)).toBeNull(); // now
    expect(validateStartsAt('2026-12-01T11:59', NOW)).toBeNull(); // one minute ago
    expect(validateStartsAt('2026-12-01T11:58', NOW)).toEqual({ key: 'startsAtPast' });
    expect(validateStartsAt('2026-12-02T09:00', NOW)).toBeNull();
  });

  it('accepts up to a year ahead and rejects later', () => {
    expect(validateStartsAt('2027-12-01T12:00', NOW)).toBeNull();
    expect(validateStartsAt('2027-12-01T12:01', NOW)).toEqual({ key: 'startsAtTooFar' });
  });
});

describe('validateDuration', () => {
  const invalid = { key: 'durationInvalid', values: { min: 5, max: 480 } };

  it('accepts whole minutes from 5 to 480', () => {
    for (const value of ['5', '60', ' 90 ', '480'])
      expect(validateDuration(value), value).toBeNull();
  });

  it('rejects everything else', () => {
    for (const value of ['', '4', '481', '0', '-5', '30.5', '1e2', 'abc', '60 min', '0x20']) {
      expect(validateDuration(value), value).toEqual(invalid);
    }
  });
});

describe('toMeetingInput', () => {
  it('converts the form to the API shape: UTC time, number, null for an empty description', () => {
    expect(
      toMeetingInput({
        title: '  Sync ',
        description: '   ',
        startsAt: '2026-12-01T12:00',
        durationMinutes: ' 45 ',
        callType: 'audio',
      }),
    ).toEqual({
      title: 'Sync',
      description: null,
      startsAt: '2026-12-01T15:00:00.000Z',
      durationMinutes: 45,
      callType: 'audio',
    });
  });
});

describe('valuesFromMeeting', () => {
  it('fills the form in the user’s time zone, with an empty text for no description', () => {
    expect(
      valuesFromMeeting(
        meeting({
          description: null,
          startsAt: '2026-12-01T15:00:00.000Z',
          durationMinutes: 90,
          callType: 'audio',
        }),
      ),
    ).toEqual({
      title: 'Weekly sync',
      description: '',
      startsAt: '2026-12-01T12:00',
      durationMinutes: '90',
      callType: 'audio',
    });
  });

  it('round-trips with toMeetingInput without changing anything', () => {
    const saved = meeting({ startsAt: '2026-12-01T15:00:00.000Z' });
    expect(changesBetween(saved, toMeetingInput(valuesFromMeeting(saved)))).toEqual({});
  });
});

describe('changesBetween', () => {
  const saved = meeting({
    title: 'Sync',
    description: 'Agenda',
    startsAt: '2026-12-01T15:00:00.000Z',
    durationMinutes: 60,
    callType: 'video',
  });
  const same = {
    title: 'Sync',
    description: 'Agenda',
    startsAt: '2026-12-01T15:00:00Z', // same instant, written differently
    durationMinutes: 60,
    callType: 'video' as const,
  };

  it('is empty when nothing changed, even if the time is written differently', () => {
    expect(changesBetween(saved, same)).toEqual({});
  });

  it('contains only what changed, and null when the description was cleared', () => {
    expect(changesBetween(saved, { ...same, title: 'New' })).toEqual({ title: 'New' });
    expect(changesBetween(saved, { ...same, description: null })).toEqual({ description: null });
    expect(
      changesBetween(saved, { ...same, startsAt: '2026-12-02T15:00:00.000Z', durationMinutes: 30 }),
    ).toEqual({ startsAt: '2026-12-02T15:00:00.000Z', durationMinutes: 30 });
    expect(changesBetween(saved, { ...same, callType: 'audio' })).toEqual({ callType: 'audio' });
  });
});

describe('problemFromMeetingIssue', () => {
  it('maps the API’s issues to messages on the right fields', () => {
    expect(problemFromMeetingIssue({ path: 'startsAt', code: 'in_the_past' })?.problem.key).toBe(
      'startsAtPast',
    );
    expect(problemFromMeetingIssue({ path: 'startsAt', code: 'too_far_ahead' })?.problem.key).toBe(
      'startsAtTooFar',
    );
    expect(problemFromMeetingIssue({ path: 'startsAt', code: 'invalid_format' })?.problem.key).toBe(
      'startsAtInvalid',
    );
    expect(problemFromMeetingIssue({ path: 'title', code: 'too_big' })?.problem.key).toBe(
      'titleTooLong',
    );
    expect(problemFromMeetingIssue({ path: 'title', code: 'too_small' })?.problem.key).toBe(
      'titleRequired',
    );
    expect(problemFromMeetingIssue({ path: 'durationMinutes', code: 'too_small' })?.field).toBe(
      'durationMinutes',
    );
    expect(problemFromMeetingIssue({ path: 'hostId', code: 'unrecognized_key' })).toBeNull();
  });
});

describe('describeMeetingFailure', () => {
  it('turns each API error into a message for the form or a field', () => {
    expect(describeMeetingFailure(failure('user_not_found'))).toEqual({
      fields: { email: { key: 'userNotFound' } },
    });
    expect(describeMeetingFailure(failure('already_invited'))).toEqual({
      fields: { email: { key: 'alreadyInvited' } },
    });
    expect(describeMeetingFailure(failure('invitee_limit_reached'))).toEqual({
      form: 'inviteeLimit',
    });
    expect(describeMeetingFailure(failure('invalid_state'))).toEqual({ form: 'invalidState' });
    expect(describeMeetingFailure(failure('forbidden'))).toEqual({ form: 'forbidden' });
    expect(describeMeetingFailure(failure('not_found'))).toEqual({ form: 'notFound' });
    expect(describeMeetingFailure(failure('rate_limited'))).toEqual({ form: 'rateLimited' });
    expect(describeMeetingFailure(failure('network_error'))).toEqual({ form: 'network' });
    expect(describeMeetingFailure(failure('internal_error'))).toEqual({ form: 'unexpected' });
    expect(describeMeetingFailure(new Error('boom'))).toEqual({ form: 'unexpected' });
  });

  it('maps validation details to fields, or to a general message when none fits', () => {
    expect(
      describeMeetingFailure(
        failure('validation_error', [{ path: 'startsAt', code: 'in_the_past' }] as never),
      ),
    ).toEqual({ fields: { startsAt: { key: 'startsAtPast' } } });
    expect(
      describeMeetingFailure(
        failure('validation_error', [{ path: 'hostId', code: 'unrecognized_key' }] as never),
      ),
    ).toEqual({ form: 'validation' });
  });

  it('gives button actions a single message', () => {
    expect(describeActionFailure(failure('invalid_state'))).toBe('invalidState');
    expect(describeActionFailure(failure('user_not_found'))).toBe('unexpected');
    expect(describeActionFailure(new Error('x'))).toBe('unexpected');
  });

  it('describes pages that could not load', () => {
    expect(describeLoadFailure(failure('not_found'))).toBe('notFound');
    expect(describeLoadFailure(failure('network_error'))).toBe('network');
    expect(describeLoadFailure(failure('internal_error'))).toBe('loadFailed');
    expect(describeLoadFailure(new Error('x'))).toBe('loadFailed');
  });
});
