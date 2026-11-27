import { describe, expect, it } from 'vitest';
import { HttpError } from '../errorResponse.js';
import { parseBody } from '../validation.js';
import {
  addInviteeBodySchema,
  createMeetingBodySchema,
  inviteeParamsSchema,
  listMeetingsQuerySchema,
  meetingParamsSchema,
  updateMeetingBodySchema,
} from './meetings.js';

const valid = {
  title: 'Weekly sync',
  description: 'Agenda',
  startsAt: '2026-12-01T15:00:00Z',
  durationMinutes: 60,
  callType: 'video',
};

function failureOf(schema: Parameters<typeof parseBody>[0], body: unknown): HttpError {
  try {
    parseBody(schema, body);
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('Expected validation to fail');
}

const pathsOf = (error: HttpError): string[] => (error.details ?? []).map((detail) => detail.path);

describe('createMeetingBodySchema', () => {
  it('accepts a valid body and turns the start time into a Date', () => {
    const parsed = parseBody(createMeetingBodySchema, valid);
    expect(parsed).toEqual({ ...valid, startsAt: new Date('2026-12-01T15:00:00.000Z') });
  });

  it('treats a missing description, null and blank text all as no description', () => {
    const { description: _omitted, ...withoutDescription } = valid;
    expect(parseBody(createMeetingBodySchema, withoutDescription).description).toBeNull();
    expect(
      parseBody(createMeetingBodySchema, { ...valid, description: null }).description,
    ).toBeNull();
    expect(
      parseBody(createMeetingBodySchema, { ...valid, description: '   ' }).description,
    ).toBeNull();
  });

  it('trims the title and description', () => {
    const parsed = parseBody(createMeetingBodySchema, {
      ...valid,
      title: '  Sync  ',
      description: '  Hi  ',
    });
    expect(parsed.title).toBe('Sync');
    expect(parsed.description).toBe('Hi');
  });

  it('accepts offsets and normalizes the start time to UTC', () => {
    const parsed = parseBody(createMeetingBodySchema, {
      ...valid,
      startsAt: '2026-12-01T15:00:00+02:00',
    });
    expect(parsed.startsAt.toISOString()).toBe('2026-12-01T13:00:00.000Z');
  });

  it('rejects start times without a time zone, dates only, impossible dates, and non-strings', () => {
    for (const startsAt of [
      '2026-12-01T15:00:00',
      '2026-12-01',
      '2026-02-31T10:00:00Z',
      'tomorrow',
      '',
      1796137200000,
      null,
    ]) {
      expect(
        pathsOf(failureOf(createMeetingBodySchema, { ...valid, startsAt })),
        String(startsAt),
      ).toEqual(['startsAt']);
    }
  });

  it('enforces the title length: 1 to 120 characters', () => {
    for (const title of ['', '   ', 'a'.repeat(121)]) {
      expect(pathsOf(failureOf(createMeetingBodySchema, { ...valid, title }))).toEqual(['title']);
    }
    expect(() =>
      parseBody(createMeetingBodySchema, { ...valid, title: 'a'.repeat(120) }),
    ).not.toThrow();
  });

  it('enforces the description length: at most 2000 characters', () => {
    expect(() =>
      parseBody(createMeetingBodySchema, { ...valid, description: 'a'.repeat(2000) }),
    ).not.toThrow();
    expect(
      pathsOf(failureOf(createMeetingBodySchema, { ...valid, description: 'a'.repeat(2001) })),
    ).toEqual(['description']);
  });

  it('enforces the duration: whole minutes from 5 to 480', () => {
    for (const durationMinutes of [4, 481, 0, -5, 30.5, '60', null]) {
      expect(
        pathsOf(failureOf(createMeetingBodySchema, { ...valid, durationMinutes })),
        String(durationMinutes),
      ).toEqual(['durationMinutes']);
    }
    for (const durationMinutes of [5, 480]) {
      expect(() => parseBody(createMeetingBodySchema, { ...valid, durationMinutes })).not.toThrow();
    }
  });

  it('accepts only audio or video as call type', () => {
    for (const callType of ['Audio', 'screen', '', null]) {
      expect(pathsOf(failureOf(createMeetingBodySchema, { ...valid, callType }))).toEqual([
        'callType',
      ]);
    }
    expect(() => parseBody(createMeetingBodySchema, { ...valid, callType: 'audio' })).not.toThrow();
  });

  it('rejects missing and unknown fields, naming them without echoing values', () => {
    expect(pathsOf(failureOf(createMeetingBodySchema, {})).sort()).toEqual([
      'callType',
      'durationMinutes',
      'startsAt',
      'title',
    ]);
    const error = failureOf(createMeetingBodySchema, {
      ...valid,
      hostId: 'someone-else',
      status: 'ended',
    });
    expect(error.details).toEqual([
      { path: 'hostId', code: 'unrecognized_key' },
      { path: 'status', code: 'unrecognized_key' },
    ]);
    expect(JSON.stringify(error.details)).not.toContain('someone-else');
  });
});

describe('updateMeetingBodySchema', () => {
  it('accepts any single field', () => {
    expect(parseBody(updateMeetingBodySchema, { title: 'New' })).toEqual({ title: 'New' });
    expect(parseBody(updateMeetingBodySchema, { callType: 'audio' })).toEqual({
      callType: 'audio',
    });
  });

  it('distinguishes clearing the description (null) from leaving it alone (absent)', () => {
    expect(parseBody(updateMeetingBodySchema, { description: null })).toEqual({
      description: null,
    });
    expect(parseBody(updateMeetingBodySchema, { description: '' })).toEqual({ description: null });
    expect(parseBody(updateMeetingBodySchema, { title: 'x' })).not.toHaveProperty('description');
  });

  it('rejects an empty change set', () => {
    expect(failureOf(updateMeetingBodySchema, {}).status).toBe(400);
  });

  it('applies the same field rules as creation', () => {
    expect(pathsOf(failureOf(updateMeetingBodySchema, { durationMinutes: 4 }))).toEqual([
      'durationMinutes',
    ]);
    expect(pathsOf(failureOf(updateMeetingBodySchema, { title: '' }))).toEqual(['title']);
    expect(pathsOf(failureOf(updateMeetingBodySchema, { startsAt: '2026-12-01' }))).toEqual([
      'startsAt',
    ]);
  });

  it('does not allow changing the host or status', () => {
    expect(failureOf(updateMeetingBodySchema, { title: 'x', hostId: 'y' }).details).toEqual([
      { path: 'hostId', code: 'unrecognized_key' },
    ]);
    // Two problems are reported: the unknown field, and that nothing valid is left to change.
    expect(failureOf(updateMeetingBodySchema, { status: 'cancelled' }).details).toEqual([
      { path: 'status', code: 'unrecognized_key' },
      { path: '', code: 'custom' },
    ]);
  });
});

describe('addInviteeBodySchema', () => {
  it('normalizes the email like registration does', () => {
    expect(parseBody(addInviteeBodySchema, { email: '  Ana@Example.TEST ' })).toEqual({
      email: 'ana@example.test',
    });
  });

  it('rejects invalid emails and extra fields', () => {
    expect(pathsOf(failureOf(addInviteeBodySchema, { email: 'nope' }))).toEqual(['email']);
    expect(
      pathsOf(failureOf(addInviteeBodySchema, { email: 'a@example.test', role: 'host' })),
    ).toEqual(['role']);
    expect(pathsOf(failureOf(addInviteeBodySchema, {}))).toEqual(['email']);
  });
});

describe('path parameters', () => {
  const id = '3f0e4b1c-6a52-4a67-9d5e-1f2a3b4c5d6e';

  it('accepts UUIDs', () => {
    expect(parseBody(meetingParamsSchema, { id })).toEqual({ id });
    expect(parseBody(inviteeParamsSchema, { id, userId: id })).toEqual({ id, userId: id });
  });

  it('rejects anything else, including injection-style values', () => {
    for (const bad of ['1', 'not-a-uuid', "' OR 1=1 --", `${id}x`, '', '../etc/passwd']) {
      expect(pathsOf(failureOf(meetingParamsSchema, { id: bad })), bad).toEqual(['id']);
    }
    expect(pathsOf(failureOf(inviteeParamsSchema, { id, userId: 'x' }))).toEqual(['userId']);
  });
});

describe('listMeetingsQuerySchema', () => {
  it('applies defaults', () => {
    expect(parseBody(listMeetingsQuerySchema, {})).toEqual({
      when: 'upcoming',
      limit: 20,
      offset: 0,
    });
  });

  it('coerces numeric strings, as query strings are always text', () => {
    expect(parseBody(listMeetingsQuerySchema, { when: 'past', limit: '50', offset: '10' })).toEqual(
      {
        when: 'past',
        limit: 50,
        offset: 10,
      },
    );
  });

  it('enforces the page bounds: limit 1-50, offset 0 or more', () => {
    for (const query of [
      { limit: '0' },
      { limit: '51' },
      { limit: '-1' },
      { limit: '2.5' },
      { limit: 'abc' },
      { limit: ['1', '2'] },
    ]) {
      expect(pathsOf(failureOf(listMeetingsQuerySchema, query)), JSON.stringify(query)).toEqual([
        'limit',
      ]);
    }
    for (const query of [
      { offset: '-1' },
      { offset: '1.5' },
      { offset: 'x' },
      { offset: '1000001' },
    ]) {
      expect(pathsOf(failureOf(listMeetingsQuerySchema, query)), JSON.stringify(query)).toEqual([
        'offset',
      ]);
    }
  });

  it('accepts only upcoming or past, and rejects unknown parameters', () => {
    expect(pathsOf(failureOf(listMeetingsQuerySchema, { when: 'all' }))).toEqual(['when']);
    expect(pathsOf(failureOf(listMeetingsQuerySchema, { sort: 'desc' }))).toEqual(['sort']);
  });
});
