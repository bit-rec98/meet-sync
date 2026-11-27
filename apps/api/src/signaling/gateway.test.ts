import { CLOSE_CODES, SIGNALING_PATH } from '@meet-sync/signaling-protocol';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestContext,
  startSignalingServer,
  type RunningSignalingServer,
} from '../test/app.js';
import { clearAllTables } from '../test/database.js';
import {
  createPeople,
  scheduleMeeting,
  socketUrl,
  ticketValue,
  type Person,
} from '../test/scenario.js';
import { TestClient } from '../test/signalingClient.js';

const UNKNOWN_PEER = '00000000-0000-4000-8000-000000000000';
const SDP = 'v=0\r\no=- 46117317 2 IN IP4 127.0.0.1\r\ns=-\r\n';
const CANDIDATE = {
  candidate: 'candidate:1 1 udp 2113937151 192.0.2.1 54400 typ host',
  sdpMid: '0',
  sdpMLineIndex: 0,
};
const MINUTE_MS = 60_000;

const context = createTestContext();
const { services, clock } = context;

let host: Person;
let ana: Person;
let ben: Person;
let cleo: Person;
let stranger: Person;
const servers: RunningSignalingServer[] = [];
const clients: TestClient[] = [];

beforeEach(async () => {
  clock.current = new Date();
  context.logs.length = 0;
  await clearAllTables(context.pool);
  [host, ana, ben, cleo, stranger] = (await createPeople(context, [
    'Hana Host',
    'Ana',
    'Ben',
    'Cleo',
    'Sam Stranger',
  ])) as [Person, Person, Person, Person, Person];
});

afterEach(async () => {
  // Every message the server sent must follow the protocol.
  for (const client of clients)
    expect(client.invalid, 'messages that break the protocol').toEqual([]);
  clients.length = 0;
  for (const server of servers.splice(0)) await server.close();
});

afterAll(() => context.close());

const start = async (overrides: Parameters<typeof startSignalingServer>[1] = {}) => {
  const server = await startSignalingServer(context, overrides);
  servers.push(server);
  return server;
};

/** Opens a connection the way the web app does: ticket over HTTP, then the WebSocket. */
async function open(
  server: RunningSignalingServer,
  person: Person,
  meetingId: string,
  options: { autoPong?: boolean } = {},
): Promise<TestClient> {
  const ticket = await ticketValue(server.httpUrl, person, meetingId);
  const client = await TestClient.connect(socketUrl(server.wsUrl, ticket), options);
  clients.push(client);
  return client;
}

async function enter(
  server: RunningSignalingServer,
  person: Person,
  meetingId: string,
  media: 'audio' | 'video' = 'video',
) {
  const client = await open(server, person, meetingId);
  client.send({ type: 'join', media });
  const joined = await client.next('joined');
  return { client, selfId: joined.selfId, peers: joined.peers };
}

const api = (server: RunningSignalingServer, path: string, person: Person, method = 'DELETE') =>
  person.bearer().then((authorization) =>
    fetch(`${server.httpUrl}/api/v1${path}`, {
      method,
      headers: { Authorization: authorization },
    }),
  );

describe('opening a connection', () => {
  it('refuses a connection without a valid ticket', async () => {
    const server = await start();
    for (const query of [
      '',
      '?ticket=',
      '?ticket=garbage',
      `?ticket=${'a'.repeat(43)}`,
      `?ticket=${'a'.repeat(5000)}`,
    ]) {
      const result = await TestClient.attempt(`${server.wsUrl}${SIGNALING_PATH}${query}`);
      expect(result, query.slice(0, 30)).toEqual({ status: 401 });
    }
  });

  it('serves the signaling path only', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const ticket = await ticketValue(server.httpUrl, ana, meetingId);
    for (const path of ['/', '/ws', '/api/v1/wss', `${SIGNALING_PATH}/extra`, '/api/v1/health']) {
      const result = await TestClient.attempt(`${server.wsUrl}${path}?ticket=${ticket}`);
      expect(result, path).toEqual({ status: 404 });
    }
    // None of those attempts used the ticket up.
    const client = await TestClient.connect(socketUrl(server.wsUrl, ticket));
    clients.push(client);
  });

  it('works only once per ticket', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const ticket = await ticketValue(server.httpUrl, ana, meetingId);
    clients.push(await TestClient.connect(socketUrl(server.wsUrl, ticket)));
    expect(await TestClient.attempt(socketUrl(server.wsUrl, ticket))).toEqual({ status: 401 });
  });

  it('refuses a ticket after 30 seconds', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const ticket = await ticketValue(server.httpUrl, ana, meetingId);
    clock.current = new Date(clock.current.getTime() + 30_000);
    expect(await TestClient.attempt(socketUrl(server.wsUrl, ticket))).toEqual({ status: 401 });
  });

  it('refuses pages of other sites, without using the ticket up, and accepts the web app and non-browsers', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const ticket = await ticketValue(server.httpUrl, ana, meetingId);
    const url = socketUrl(server.wsUrl, ticket);

    for (const origin of [
      'https://evil.example',
      'null',
      `${context.config.webOrigins[0]}.evil.example`,
    ]) {
      expect(await TestClient.attempt(url, { origin }), origin).toEqual({ status: 403 });
    }
    const allowed = await TestClient.connect(url, { origin: context.config.webOrigins[0] ?? '' });
    clients.push(allowed);

    const second = await ticketValue(server.httpUrl, ana, meetingId);
    clients.push(await TestClient.connect(socketUrl(server.wsUrl, second))); // no Origin header at all
  });

  it('takes the meeting from the ticket, never from the address', async () => {
    const server = await start();
    const mine = await scheduleMeeting(context, host, [ana]);
    const theirs = await scheduleMeeting(context, host, [ben]);
    const { client: hostInTheirs } = await enter(server, host, theirs);

    const ticket = await ticketValue(server.httpUrl, ana, mine);
    const client = await TestClient.connect(
      `${socketUrl(server.wsUrl, ticket)}&meetingId=${theirs}`,
    );
    clients.push(client);
    client.send({ type: 'join', media: 'video' });
    const joined = await client.next('joined');
    expect(joined.peers).toEqual([]); // not in the room of the other meeting, where the host is
    expect(await hostInTheirs.untaken()).toEqual([]);
  });

  it('refuses new connections beyond the limit', async () => {
    const server = await start({ options: { maxConnections: 1 } });
    const meetingId = await scheduleMeeting(context, host, [ana, ben]);
    await open(server, ana, meetingId);
    const ticket = await ticketValue(server.httpUrl, ben, meetingId);
    expect(await TestClient.attempt(socketUrl(server.wsUrl, ticket))).toEqual({ status: 503 });
  });

  it('keeps tickets and call content out of the logs', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const ticket = await ticketValue(server.httpUrl, ana, meetingId);
    const first = await TestClient.connect(socketUrl(server.wsUrl, ticket));
    clients.push(first);
    first.send({ type: 'join', media: 'video' });
    const { selfId } = await first.next('joined');
    const second = await enter(server, host, meetingId);
    second.client.send({ type: 'offer', to: selfId, sdp: 'v=0 secret-session-description' });
    await first.next('offer');
    first.terminate();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const logText = JSON.stringify(context.logs);
    expect(logText).toContain('ws_connected');
    expect(logText).toContain('ws_joined');
    expect(logText).not.toContain(ticket);
    expect(logText).not.toContain('secret-session-description');
    expect(logText).not.toContain('ana@example.test');
  });
});

describe('joining and talking', () => {
  it('admits two people and tells each about the other, using display names only', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana, ben]);
    const first = await enter(server, ana, meetingId);
    expect(first.peers).toEqual([]);

    const second = await enter(server, ben, meetingId, 'audio');
    expect(second.peers).toEqual([
      {
        id: first.selfId,
        displayName: 'Ana',
        media: 'video',
        audioEnabled: true,
        videoEnabled: true,
      },
    ]);
    const arrival = await first.client.next('peer-joined');
    expect(arrival.peer).toEqual({
      id: second.selfId,
      displayName: 'Ben',
      media: 'audio',
      audioEnabled: true,
      videoEnabled: false,
    });
    expect(JSON.stringify(first.client.messages)).not.toMatch(/@example\.test|userId|user-/);
  });

  it('relays offers, answers and candidates to the addressed peer only, with the sender set by the server', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana, ben, cleo]);
    const a = await enter(server, ana, meetingId);
    const b = await enter(server, ben, meetingId);
    const c = await enter(server, cleo, meetingId);

    b.client.send({ type: 'offer', to: a.selfId, sdp: SDP });
    expect(await a.client.next('offer')).toEqual({ type: 'offer', from: b.selfId, sdp: SDP });
    a.client.send({ type: 'answer', to: b.selfId, sdp: SDP });
    expect(await b.client.next('answer')).toEqual({ type: 'answer', from: a.selfId, sdp: SDP });
    a.client.send({ type: 'ice-candidate', to: b.selfId, candidate: CANDIDATE });
    expect(await b.client.next('ice-candidate')).toEqual({
      type: 'ice-candidate',
      from: a.selfId,
      candidate: CANDIDATE,
    });

    const noise = (await c.client.untaken()).filter((message) =>
      ['offer', 'answer', 'ice-candidate'].includes(message.type),
    );
    expect(noise).toEqual([]); // the third person saw none of it
  });

  it('closes the connection of anyone who tries to name the sender themselves', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana, ben, cleo]);
    const a = await enter(server, ana, meetingId);
    const b = await enter(server, ben, meetingId);
    const c = await enter(server, cleo, meetingId);

    // Ben pretends the offer comes from Cleo.
    b.client.send({ type: 'offer', to: a.selfId, sdp: SDP, from: c.selfId });
    expect(await b.client.next('error')).toEqual({ type: 'error', code: 'invalid_message' });
    expect((await b.client.closed()).code).toBe(CLOSE_CODES.policyViolation);
    expect((await a.client.untaken()).some((message) => message.type === 'offer')).toBe(false);
  });

  it('answers unknown_peer, and keeps the connection, when the addressee is not in the room', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const a = await enter(server, ana, meetingId);
    a.client.send({ type: 'offer', to: UNKNOWN_PEER, sdp: SDP });
    expect(await a.client.next('error')).toEqual({ type: 'error', code: 'unknown_peer' });
    a.client.send({ type: 'offer', to: a.selfId, sdp: SDP }); // to oneself
    expect(await a.client.next('error')).toEqual({ type: 'error', code: 'unknown_peer' });
    expect(a.client.isClosed).toBe(false);
  });

  it('keeps meetings apart: nothing crosses even with the exact peer id', async () => {
    const server = await start();
    const privateMeeting = await scheduleMeeting(context, host, [ana]);
    const otherMeeting = await scheduleMeeting(context, host, [ben]);
    const inPrivate = await enter(server, ana, privateMeeting);
    const inOther = await enter(server, ben, otherMeeting);

    inOther.client.send({ type: 'offer', to: inPrivate.selfId, sdp: SDP });
    expect(await inOther.client.next('error')).toEqual({ type: 'error', code: 'unknown_peer' });
    inOther.client.send({ type: 'ice-candidate', to: inPrivate.selfId, candidate: CANDIDATE });
    expect(await inOther.client.next('error')).toEqual({ type: 'error', code: 'unknown_peer' });
    expect(await inPrivate.client.untaken()).toEqual([]);
  });

  it('refuses messages before joining, and a second join', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const client = await open(server, ana, meetingId);
    client.send({ type: 'offer', to: UNKNOWN_PEER, sdp: SDP });
    expect(await client.next('error')).toEqual({ type: 'error', code: 'not_joined' });
    client.send({ type: 'media-state', audioEnabled: false, videoEnabled: false });
    expect(await client.next('error')).toEqual({ type: 'error', code: 'not_joined' });
    client.send({ type: 'leave' });
    expect(await client.next('error')).toEqual({ type: 'error', code: 'not_joined' });

    client.send({ type: 'join', media: 'video' });
    await client.next('joined');
    client.send({ type: 'join', media: 'video' });
    expect(await client.next('error')).toEqual({ type: 'error', code: 'already_joined' });
    expect(client.isClosed).toBe(false);
  });

  it('shares mute and camera changes, including with people who join later', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana, ben]);
    const a = await enter(server, ana, meetingId);
    const b = await enter(server, ben, meetingId);
    a.client.send({ type: 'media-state', audioEnabled: false, videoEnabled: true });
    expect(await b.client.next('peer-media-state')).toEqual({
      type: 'peer-media-state',
      peerId: a.selfId,
      audioEnabled: false,
      videoEnabled: true,
    });
    const late = await enter(server, host, meetingId);
    expect(late.peers.find((peer) => peer.id === a.selfId)).toMatchObject({ audioEnabled: false });
  });

  it('tells the others when someone leaves, and when a connection simply drops', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana, ben, cleo]);
    const a = await enter(server, ana, meetingId);
    const b = await enter(server, ben, meetingId);
    const c = await enter(server, cleo, meetingId);

    b.client.send({ type: 'leave' });
    expect((await b.client.closed()).code).toBe(CLOSE_CODES.normal);
    expect(await a.client.next('peer-left')).toEqual({ type: 'peer-left', peerId: b.selfId });
    expect(await c.client.next('peer-left')).toEqual({ type: 'peer-left', peerId: b.selfId });

    c.client.terminate(); // no goodbye: the network failed
    expect(await a.client.next('peer-left')).toEqual({ type: 'peer-left', peerId: c.selfId });
    expect(server.signaling.connectionCount()).toBe(1);
  });
});

describe('who may join, and how many', () => {
  it('refuses video in an audio meeting but lets the person join with audio', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana], { callType: 'audio' });
    const client = await open(server, ana, meetingId);
    client.send({ type: 'join', media: 'video' });
    expect(await client.next('error')).toEqual({ type: 'error', code: 'invalid_media' });
    expect(client.isClosed).toBe(false);
    client.send({ type: 'join', media: 'audio' });
    expect((await client.next('joined')).peers).toEqual([]);
  });

  it('holds only as many people as the call type allows, and frees a place when someone leaves', async () => {
    const server = await start({ maxParticipants: { audio: 10, video: 2 } });
    const meetingId = await scheduleMeeting(context, host, [ana, ben, cleo]);
    const a = await enter(server, ana, meetingId);
    await enter(server, ben, meetingId);

    const third = await open(server, cleo, meetingId);
    third.send({ type: 'join', media: 'video' });
    expect(await third.next('error')).toEqual({ type: 'error', code: 'room_full' });
    expect((await third.closed()).code).toBe(CLOSE_CODES.roomFull);

    a.client.send({ type: 'leave' });
    await a.client.closed();
    const retry = await enter(server, cleo, meetingId);
    expect(retry.peers).toHaveLength(1);
  });

  it('uses the audio limit for audio meetings', async () => {
    const server = await start({ maxParticipants: { audio: 2, video: 4 } });
    const meetingId = await scheduleMeeting(context, host, [ana, ben, cleo], { callType: 'audio' });
    await enter(server, ana, meetingId, 'audio');
    await enter(server, ben, meetingId, 'audio');
    const third = await open(server, cleo, meetingId);
    third.send({ type: 'join', media: 'audio' });
    expect(await third.next('error')).toEqual({ type: 'error', code: 'room_full' });
  });

  it('lets a person back in from another tab without taking a second place, ending the older connection', async () => {
    const server = await start({ maxParticipants: { audio: 10, video: 2 } });
    const meetingId = await scheduleMeeting(context, host, [ana, ben]);
    const observer = await enter(server, ben, meetingId);
    const firstTab = await enter(server, ana, meetingId);
    await observer.client.next('peer-joined');

    const secondTab = await enter(server, ana, meetingId); // the room is full (2), but this replaces
    expect(await firstTab.client.next('bye')).toEqual({ type: 'bye', reason: 'replaced' });
    expect((await firstTab.client.closed()).code).toBe(CLOSE_CODES.replaced);
    expect(await observer.client.next('peer-left')).toEqual({
      type: 'peer-left',
      peerId: firstTab.selfId,
    });
    expect((await observer.client.next('peer-joined')).peer.id).toBe(secondTab.selfId);
    expect(secondTab.peers.map((peer) => peer.id)).toEqual([observer.selfId]);
  });

  it('checks access again when joining: the window can close after the ticket was issued', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana], { durationMinutes: 30 });
    const client = await open(server, ana, meetingId);
    clock.current = new Date(clock.current.getTime() + 60 * MINUTE_MS); // the meeting is over now
    client.send({ type: 'join', media: 'video' });
    expect(await client.next('error')).toEqual({ type: 'error', code: 'not_allowed' });
    expect((await client.closed()).code).toBe(CLOSE_CODES.notAllowed);
  });

  it('checks access again when joining: a person removed after getting a ticket cannot join', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana, ben]);
    const client = await open(server, ana, meetingId);
    await services.meetings.removeInvitee(host.id, meetingId, ana.id);
    client.send({ type: 'join', media: 'video' });
    expect(await client.next('error')).toEqual({ type: 'error', code: 'not_allowed' });
    expect((await client.closed()).code).toBe(CLOSE_CODES.notAllowed);
  });

  it('reports a failure on the server side as such, and closes', async () => {
    const server = await start({
      authorizeJoin: () => Promise.reject(new Error('database is down')),
    });
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const client = await open(server, ana, meetingId);
    client.send({ type: 'join', media: 'video' });
    expect(await client.next('error')).toEqual({ type: 'error', code: 'server_error' });
    expect((await client.closed()).code).toBe(CLOSE_CODES.internalError);
    expect(JSON.stringify(context.logs)).not.toContain('database is down');
  });
});

describe('changes made through the REST API reach people in the call', () => {
  it('disconnects a person the host removes, and tells the others', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana, ben]);
    const h = await enter(server, host, meetingId);
    const a = await enter(server, ana, meetingId);
    const b = await enter(server, ben, meetingId);

    const response = await api(server, `/meetings/${meetingId}/invitees/${ana.id}`, host);
    expect(response.status).toBe(204);

    expect(await a.client.next('bye')).toEqual({ type: 'bye', reason: 'removed' });
    expect((await a.client.closed()).code).toBe(CLOSE_CODES.removed);
    expect(await h.client.next('peer-left')).toEqual({ type: 'peer-left', peerId: a.selfId });
    expect(await b.client.next('peer-left')).toEqual({ type: 'peer-left', peerId: a.selfId });
    expect(b.client.isClosed).toBe(false);

    // The removed person cannot get back in.
    const retry = await api(server, '/ws-tickets', ana, 'POST');
    expect(retry.status).toBeGreaterThanOrEqual(400);
  });

  it('disconnects an invitee who leaves the meeting through the API', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const h = await enter(server, host, meetingId);
    const a = await enter(server, ana, meetingId);
    expect((await api(server, `/meetings/${meetingId}/invitees/${ana.id}`, ana)).status).toBe(204);
    expect((await a.client.closed()).code).toBe(CLOSE_CODES.removed);
    expect(await h.client.next('peer-left')).toEqual({ type: 'peer-left', peerId: a.selfId });
  });

  it('ends the call for everyone when the host cancels the meeting', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana, ben]);
    const elsewhere = await scheduleMeeting(context, host, [cleo]);
    const h = await enter(server, host, meetingId);
    const a = await enter(server, ana, meetingId);
    const unrelated = await enter(server, cleo, elsewhere);

    expect((await api(server, `/meetings/${meetingId}`, host)).status).toBe(204);
    for (const { client } of [h, a]) {
      expect(await client.next('bye')).toEqual({ type: 'bye', reason: 'meeting_cancelled' });
      expect((await client.closed()).code).toBe(CLOSE_CODES.meetingCancelled);
    }
    expect(unrelated.client.isClosed).toBe(false); // another meeting is untouched
  });

  it('does not disconnect anyone when the request is refused', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana, ben]);
    const a = await enter(server, ana, meetingId);
    const b = await enter(server, ben, meetingId);

    // An invitee may not remove another invitee, nor cancel the meeting.
    expect((await api(server, `/meetings/${meetingId}/invitees/${ben.id}`, ana)).status).toBe(403);
    expect((await api(server, `/meetings/${meetingId}`, ana)).status).toBe(403);
    expect((await api(server, `/meetings/${meetingId}`, stranger)).status).toBe(404);
    expect(a.client.isClosed || b.client.isClosed).toBe(false);
    expect(await b.client.untaken()).toEqual([]);
  });
});

describe('protecting the server', () => {
  it('closes the connection for messages that are not valid, whatever is wrong with them', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const attempts: (string | Buffer)[] = [
      'not json',
      '{',
      '[]',
      '"join"',
      '{"type":"nope"}',
      '{"type":"join"}',
      '{"type":"join","media":"video","x":1}',
    ];
    for (const raw of attempts) {
      const client = await open(server, ana, meetingId);
      client.sendRaw(raw);
      expect(await client.next('error'), String(raw)).toEqual({
        type: 'error',
        code: 'invalid_message',
      });
      expect((await client.closed()).code, String(raw)).toBe(CLOSE_CODES.policyViolation);
    }
  });

  it('refuses binary messages', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const client = await open(server, ana, meetingId);
    client.sendRaw(Buffer.from([1, 2, 3]), true);
    expect(await client.next('error')).toEqual({ type: 'error', code: 'invalid_message' });
    expect((await client.closed()).code).toBe(CLOSE_CODES.policyViolation);
  });

  it('closes the connection when a message is larger than 64 KiB', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const client = await open(server, ana, meetingId);
    client.sendRaw(
      JSON.stringify({ type: 'join', media: 'video', padding: 'x'.repeat(70 * 1024) }),
    );
    expect((await client.closed()).code).toBe(CLOSE_CODES.messageTooBig);
  });

  it('closes the connection of someone who sends messages too fast', async () => {
    const server = await start({ options: { rateLimit: { capacity: 5, refillPerSecond: 1 } } });
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const a = await enter(server, ana, meetingId);
    for (let count = 0; count < 20; count++) {
      a.client.send({ type: 'media-state', audioEnabled: count % 2 === 0, videoEnabled: true });
    }
    expect(await a.client.next('error')).toEqual({ type: 'error', code: 'rate_limited' });
    expect((await a.client.closed()).code).toBe(CLOSE_CODES.policyViolation);
  });

  it('lets normal traffic through: a burst of candidates when connecting to several people', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana, ben]);
    const a = await enter(server, ana, meetingId);
    const b = await enter(server, ben, meetingId);
    for (let count = 0; count < 150; count++) {
      a.client.send({ type: 'ice-candidate', to: b.selfId, candidate: CANDIDATE });
    }
    for (let count = 0; count < 150; count++) await b.client.next('ice-candidate');
    expect(a.client.isClosed).toBe(false);
  });

  it('disconnects a connection that never joins', async () => {
    const server = await start({ options: { joinTimeoutMs: 80 } });
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const client = await open(server, ana, meetingId);
    expect((await client.closed()).code).toBe(CLOSE_CODES.policyViolation);
    expect(server.signaling.connectionCount()).toBe(0);
  });

  it('keeps a connection that joins in time', async () => {
    const server = await start({ options: { joinTimeoutMs: 150 } });
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const a = await enter(server, ana, meetingId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(a.client.isClosed).toBe(false);
  });

  it('drops a connection that stops answering pings, and keeps one that answers', async () => {
    const server = await start({ options: { heartbeatIntervalMs: 60 } });
    const meetingId = await scheduleMeeting(context, host, [ana, ben]);
    const alive = await enter(server, ana, meetingId);
    const silentConnection = await open(server, ben, meetingId, { autoPong: false });
    silentConnection.send({ type: 'join', media: 'video' });
    const silent = {
      client: silentConnection,
      selfId: (await silentConnection.next('joined')).selfId,
    };

    await silent.client.closed(2000);
    expect(await alive.client.next('peer-left')).toEqual({
      type: 'peer-left',
      peerId: silent.selfId,
    });
    expect(alive.client.isClosed).toBe(false);
    expect(server.signaling.connectionCount()).toBe(1);
  });

  it('says goodbye to everyone when the server shuts down', async () => {
    const server = await start();
    const meetingId = await scheduleMeeting(context, host, [ana]);
    const h = await enter(server, host, meetingId);
    const a = await enter(server, ana, meetingId);
    await server.close();
    for (const { client } of [h, a]) {
      expect(await client.next('bye')).toEqual({ type: 'bye', reason: 'server_shutdown' });
      expect((await client.closed()).code).toBe(CLOSE_CODES.goingAway);
    }
    expect(server.signaling.connectionCount()).toBe(0);
  });
});
