import { SIGNALING_PATH, type WsTicketResponse } from '@meet-sync/signaling-protocol';
import type { UserRecord } from '../repositories/users.js';
import type { TestContext } from './app.js';
import { accessTokenFor, insertTestUser } from './fixtures.js';

const MINUTE_MS = 60 * 1000;

export type Person = UserRecord & { bearer(): Promise<string> };

/** Registered users who can act through the API, with a fresh access token on every request. */
export async function createPeople(context: TestContext, names: string[]): Promise<Person[]> {
  const people: Person[] = [];
  for (const name of names) {
    const user = await insertTestUser(context.pool, {
      displayName: name,
      email: `${name.toLowerCase().replace(/\W+/g, '-')}@example.test`,
    });
    people.push({
      ...user,
      bearer: async () =>
        `Bearer ${await accessTokenFor(user.id, context.config.accessTokenSecret, context.clock.current)}`,
    });
  }
  return people;
}

/**
 * Schedules a meeting hosted by `host` and invites `invitees`. By default it starts in ten
 * minutes, which is inside the join window (it opens 15 minutes before the start).
 */
export async function scheduleMeeting(
  context: TestContext,
  host: UserRecord,
  invitees: UserRecord[],
  options: {
    callType?: 'audio' | 'video';
    startsInMinutes?: number;
    durationMinutes?: number;
  } = {},
): Promise<string> {
  const { meetings } = context.services;
  const meeting = await meetings.create(host.id, {
    title: 'Team sync',
    description: null,
    startsAt: new Date(
      context.clock.current.getTime() + (options.startsInMinutes ?? 10) * MINUTE_MS,
    ),
    durationMinutes: options.durationMinutes ?? 60,
    callType: options.callType ?? 'video',
  });
  for (const invitee of invitees) {
    await meetings.addInvitee(host.id, meeting.id, invitee.email);
  }
  return meeting.id;
}

/** Asks the API for a ticket, as the web app would. */
export async function requestTicket(
  httpUrl: string,
  person: Person,
  meetingId: string,
): Promise<Response> {
  return fetch(`${httpUrl}/api/v1/ws-tickets`, {
    method: 'POST',
    headers: { Authorization: await person.bearer(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetingId }),
  });
}

/** The WebSocket address for a ticket. */
export const socketUrl = (wsUrl: string, ticket: string): string =>
  `${wsUrl}${SIGNALING_PATH}?ticket=${encodeURIComponent(ticket)}`;

export async function ticketValue(
  httpUrl: string,
  person: Person,
  meetingId: string,
): Promise<string> {
  const response = await requestTicket(httpUrl, person, meetingId);
  if (response.status !== 201) throw new Error(`Ticket request answered ${response.status}`);
  return ((await response.json()) as WsTicketResponse).ticket;
}
