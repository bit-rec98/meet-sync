import type { ApiClient } from './client';
import { ApiError } from './errors';

export type CallType = 'audio' | 'video';
export type MeetingStatus = 'scheduled' | 'ended' | 'cancelled';
export type MeetingRole = 'host' | 'invitee';
export type MeetingView = 'upcoming' | 'past';

export type Person = { id: string; displayName: string };
/** `email` is present only when the viewer is the host. */
export type Invitee = Person & { email?: string };

export type MeetingSummary = {
  id: string;
  title: string;
  description: string | null;
  /** ISO 8601 in UTC, e.g. 2026-12-01T15:00:00.000Z. */
  startsAt: string;
  durationMinutes: number;
  callType: CallType;
  status: MeetingStatus;
  /** The role of the signed-in user in this meeting. */
  role: MeetingRole;
  host: Person;
  inviteeCount: number;
};

export type Meeting = Omit<MeetingSummary, 'inviteeCount'> & { invitees: Invitee[] };

export type MeetingList = { items: MeetingSummary[]; limit: number; offset: number; total: number };

export type MeetingListQuery = { when: MeetingView; limit: number; offset: number };

/** What the host provides when scheduling a meeting. */
export type MeetingInput = {
  title: string;
  description: string | null;
  startsAt: string;
  durationMinutes: number;
  callType: CallType;
};

export type MeetingChanges = Partial<MeetingInput>;

// --- Checking what the server returns -------------------------------------------------------------
// The API is ours, but a proxy error page or a version mismatch must produce a clear error rather
// than a crash deep inside a component.

const malformed = (): ApiError => new ApiError({ status: 200, code: 'unknown_error' });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw malformed();
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw malformed();
  return value;
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw malformed();
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw malformed();
  return found;
}

function isoDate(value: unknown): string {
  const date = text(value);
  if (Number.isNaN(Date.parse(date))) throw malformed();
  return date;
}

function parsePerson(value: unknown): Person {
  const person = record(value);
  return { id: text(person['id']), displayName: text(person['displayName']) };
}

function parseInvitee(value: unknown): Invitee {
  const invitee = record(value);
  const person = parsePerson(invitee);
  return invitee['email'] === undefined ? person : { ...person, email: text(invitee['email']) };
}

function parseCommon(value: Record<string, unknown>) {
  return {
    id: text(value['id']),
    title: text(value['title']),
    description: value['description'] === null ? null : text(value['description']),
    startsAt: isoDate(value['startsAt']),
    durationMinutes: count(value['durationMinutes']),
    callType: oneOf(value['callType'], ['audio', 'video'] as const),
    status: oneOf(value['status'], ['scheduled', 'ended', 'cancelled'] as const),
    role: oneOf(value['role'], ['host', 'invitee'] as const),
    host: parsePerson(value['host']),
  };
}

function parseSummary(value: unknown): MeetingSummary {
  const meeting = record(value);
  return { ...parseCommon(meeting), inviteeCount: count(meeting['inviteeCount']) };
}

function parseMeeting(value: unknown): Meeting {
  const meeting = record(value);
  const invitees = meeting['invitees'];
  if (!Array.isArray(invitees)) throw malformed();
  return { ...parseCommon(meeting), invitees: invitees.map(parseInvitee) };
}

function parseList(value: unknown): MeetingList {
  const list = record(value);
  const items = list['items'];
  if (!Array.isArray(items)) throw malformed();
  return {
    items: items.map(parseSummary),
    limit: count(list['limit']),
    offset: count(list['offset']),
    total: count(list['total']),
  };
}

// --- Calls ----------------------------------------------------------------------------------------

export type MeetingsApi = ReturnType<typeof createMeetingsApi>;

export function createMeetingsApi(client: ApiClient) {
  const meetingPath = (id: string): string => `/meetings/${encodeURIComponent(id)}`;

  return {
    async list(query: MeetingListQuery): Promise<MeetingList> {
      const params = new URLSearchParams({
        when: query.when,
        limit: String(query.limit),
        offset: String(query.offset),
      });
      return parseList(await client.request<unknown>('GET', `/meetings?${params.toString()}`));
    },

    async get(id: string): Promise<Meeting> {
      return parseMeeting(await client.request<unknown>('GET', meetingPath(id)));
    },

    async create(input: MeetingInput): Promise<Meeting> {
      return parseMeeting(await client.request<unknown>('POST', '/meetings', { body: input }));
    },

    async update(id: string, changes: MeetingChanges): Promise<Meeting> {
      return parseMeeting(
        await client.request<unknown>('PATCH', meetingPath(id), { body: changes }),
      );
    },

    /** Cancels the meeting; it stays visible as cancelled. */
    async cancel(id: string): Promise<void> {
      await client.request('DELETE', meetingPath(id));
    },

    /** Invites a registered user by email. */
    async invite(id: string, email: string): Promise<Invitee> {
      const invitee = parseInvitee(
        await client.request<unknown>('POST', `${meetingPath(id)}/invitees`, { body: { email } }),
      );
      if (invitee.email === undefined) throw malformed();
      return invitee;
    },

    /** The host removes an invitee, or an invitee removes themselves. */
    async removeInvitee(id: string, userId: string): Promise<void> {
      await client.request('DELETE', `${meetingPath(id)}/invitees/${encodeURIComponent(userId)}`);
    },
  };
}
