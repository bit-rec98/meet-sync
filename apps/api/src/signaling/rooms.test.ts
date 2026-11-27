import type { ServerMessage } from '@meet-sync/signaling-protocol';
import { describe, expect, it } from 'vitest';
import { createRoomRegistry, type JoinRequest, type PeerConnection } from './rooms.js';

const REPLACED = 4001;

type FakeConnection = PeerConnection & { sent: ServerMessage[]; closedWith: number[] };

function fakeConnection(): FakeConnection {
  const connection: FakeConnection = {
    sent: [],
    closedWith: [],
    send: (message) => void connection.sent.push(message),
    close: (code) => void connection.closedWith.push(code),
  };
  return connection;
}

function join(
  registry: ReturnType<typeof createRoomRegistry>,
  user: string,
  overrides: Partial<JoinRequest> = {},
) {
  const connection = fakeConnection();
  const result = registry.join({
    meetingId: 'meeting-1',
    userId: user,
    displayName: `Name of ${user}`,
    media: 'video',
    capacity: 4,
    connection,
    replacedCloseCode: REPLACED,
    ...overrides,
  });
  if (result.status !== 'joined') return { connection, result, peerId: '' };
  return { connection, result, peerId: result.peerId };
}

const typesOf = (connection: FakeConnection): string[] =>
  connection.sent.map((message) => message.type);

describe('joining', () => {
  it('gives each peer its own id, and tells a newcomer who is already there', () => {
    const registry = createRoomRegistry();
    const ana = join(registry, 'ana');
    expect(ana.result).toMatchObject({ status: 'joined', peers: [] });

    const ben = join(registry, 'ben', { media: 'audio' });
    expect(ben.result.status === 'joined' && ben.result.peers).toEqual([
      {
        id: ana.peerId,
        displayName: 'Name of ana',
        media: 'video',
        audioEnabled: true,
        videoEnabled: true,
      },
    ]);
    expect(ana.peerId).not.toBe(ben.peerId);
  });

  it('tells the people already in the room about the newcomer, but not the newcomer about itself', () => {
    const registry = createRoomRegistry();
    const ana = join(registry, 'ana');
    const ben = join(registry, 'ben', { media: 'audio' });

    expect(ana.connection.sent).toEqual([
      {
        type: 'peer-joined',
        peer: {
          id: ben.peerId,
          displayName: 'Name of ben',
          media: 'audio',
          audioEnabled: true,
          videoEnabled: false,
        },
      },
    ]);
    expect(ben.connection.sent).toEqual([]);
  });

  it('refuses a peer when the room is full, and leaves the room as it was', () => {
    const registry = createRoomRegistry();
    const first = join(registry, 'a', { capacity: 2 });
    const second = join(registry, 'b', { capacity: 2 });
    const third = join(registry, 'c', { capacity: 2 });

    expect(third.result).toEqual({ status: 'room_full' });
    expect(registry.peerCount('meeting-1')).toBe(2);
    expect(typesOf(first.connection)).toEqual(['peer-joined']); // not told about the refused one
    expect(second.connection.sent).toEqual([]);
  });

  it('does not leave an empty room behind after a refused join', () => {
    const registry = createRoomRegistry();
    expect(join(registry, 'a', { capacity: 0 }).result).toEqual({ status: 'room_full' });
    expect(registry.roomCount()).toBe(0);
  });

  it('keeps a user to one peer per room: joining again replaces the older connection', () => {
    const registry = createRoomRegistry();
    const watcher = join(registry, 'watcher');
    const first = join(registry, 'ana');
    const second = join(registry, 'ana');

    expect(first.connection.sent).toContainEqual({ type: 'bye', reason: 'replaced' });
    expect(first.connection.closedWith).toEqual([REPLACED]);
    expect(registry.peerCount('meeting-1')).toBe(2);
    expect(second.result.status === 'joined' && second.result.peers.map((peer) => peer.id)).toEqual(
      [watcher.peerId],
    );
    // The others learn that the old peer left and the new one arrived.
    expect(watcher.connection.sent).toContainEqual({ type: 'peer-left', peerId: first.peerId });
    expect(typesOf(watcher.connection).filter((type) => type === 'peer-joined')).toHaveLength(2);
  });

  it('lets a replacing connection in even when the room is otherwise full', () => {
    const registry = createRoomRegistry();
    join(registry, 'a', { capacity: 2 });
    join(registry, 'b', { capacity: 2 });
    expect(join(registry, 'b', { capacity: 2 }).result.status).toBe('joined');
    expect(registry.peerCount('meeting-1')).toBe(2);
  });

  it('counts one user opening many tabs as one place, so nobody can fill a room alone', () => {
    const registry = createRoomRegistry();
    for (let tab = 0; tab < 10; tab++) join(registry, 'greedy', { capacity: 4 });
    expect(registry.peerCount('meeting-1')).toBe(1);
    expect(join(registry, 'other', { capacity: 4 }).result.status).toBe('joined');
  });

  it('allows the same user in different meetings at the same time', () => {
    const registry = createRoomRegistry();
    const one = join(registry, 'ana', { meetingId: 'm1' });
    const two = join(registry, 'ana', { meetingId: 'm2' });
    expect(one.connection.closedWith).toEqual([]);
    expect(registry.peerCount('m1')).toBe(1);
    expect(registry.peerCount('m2')).toBe(1);
    expect(one.peerId).not.toBe(two.peerId);
  });
});

describe('leaving', () => {
  it('removes the peer and tells the others once', () => {
    const registry = createRoomRegistry();
    const ana = join(registry, 'ana');
    const ben = join(registry, 'ben');
    expect(registry.leave(ben.peerId)).toBe(true);
    expect(ana.connection.sent.filter((message) => message.type === 'peer-left')).toEqual([
      { type: 'peer-left', peerId: ben.peerId },
    ]);
    expect(registry.leave(ben.peerId)).toBe(false); // safe to repeat
    expect(ana.connection.sent.filter((message) => message.type === 'peer-left')).toHaveLength(1);
  });

  it('frees the place for someone else, and drops the room when it empties', () => {
    const registry = createRoomRegistry();
    const a = join(registry, 'a', { capacity: 1 });
    expect(join(registry, 'b', { capacity: 1 }).result).toEqual({ status: 'room_full' });
    registry.leave(a.peerId);
    expect(registry.roomCount()).toBe(0);
    expect(join(registry, 'b', { capacity: 1 }).result.status).toBe('joined');
  });

  it('ignores a peer id it does not know', () => {
    expect(createRoomRegistry().leave('nobody')).toBe(false);
  });
});

describe('relaying between peers', () => {
  it('delivers to the named peer with the sender id taken from the registry', () => {
    const registry = createRoomRegistry();
    const ana = join(registry, 'ana');
    const ben = join(registry, 'ben');
    ana.connection.sent.length = 0;
    ben.connection.sent.length = 0;

    const result = registry.relay(ana.peerId, ben.peerId, (from) => ({
      type: 'offer',
      from,
      sdp: 'v=0',
    }));
    expect(result).toBe('sent');
    expect(ben.connection.sent).toEqual([{ type: 'offer', from: ana.peerId, sdp: 'v=0' }]);
    expect(ana.connection.sent).toEqual([]);
  });

  it('delivers only to the addressed peer, not to the rest of the room', () => {
    const registry = createRoomRegistry();
    const ana = join(registry, 'ana');
    const ben = join(registry, 'ben');
    const cleo = join(registry, 'cleo');
    cleo.connection.sent.length = 0;
    registry.relay(ana.peerId, ben.peerId, (from) => ({ type: 'answer', from, sdp: 'v=0' }));
    expect(cleo.connection.sent).toEqual([]);
  });

  it('never crosses from one meeting to another, even with the exact peer id', () => {
    const registry = createRoomRegistry();
    const insider = join(registry, 'insider', { meetingId: 'private-meeting' });
    const outsider = join(registry, 'outsider', { meetingId: 'other-meeting' });
    insider.connection.sent.length = 0;

    const result = registry.relay(outsider.peerId, insider.peerId, (from) => ({
      type: 'offer',
      from,
      sdp: 'v=0',
    }));
    expect(result).toBe('unknown_peer');
    expect(insider.connection.sent).toEqual([]);
  });

  it('refuses unknown targets, sending to oneself, and senders that are not in a room', () => {
    const registry = createRoomRegistry();
    const ana = join(registry, 'ana');
    const build = (from: string): ServerMessage => ({ type: 'offer', from, sdp: 'v=0' });
    expect(registry.relay(ana.peerId, '00000000-0000-4000-8000-000000000000', build)).toBe(
      'unknown_peer',
    );
    expect(registry.relay(ana.peerId, ana.peerId, build)).toBe('unknown_peer');
    expect(registry.relay('ghost', ana.peerId, build)).toBe('unknown_peer');
  });

  it('stops delivering to a peer that left', () => {
    const registry = createRoomRegistry();
    const ana = join(registry, 'ana');
    const ben = join(registry, 'ben');
    registry.leave(ben.peerId);
    expect(
      registry.relay(ana.peerId, ben.peerId, (from) => ({ type: 'offer', from, sdp: 'v=0' })),
    ).toBe('unknown_peer');
  });
});

describe('media state', () => {
  it('is shared with the others, and shown to people who join later', () => {
    const registry = createRoomRegistry();
    const ana = join(registry, 'ana');
    const ben = join(registry, 'ben');
    ben.connection.sent.length = 0;
    registry.setMediaState(ana.peerId, false, false);
    expect(ben.connection.sent).toEqual([
      { type: 'peer-media-state', peerId: ana.peerId, audioEnabled: false, videoEnabled: false },
    ]);
    expect(ana.connection.sent.some((message) => message.type === 'peer-media-state')).toBe(false);

    const cleo = join(registry, 'cleo');
    expect(
      cleo.result.status === 'joined' && cleo.result.peers.find((peer) => peer.id === ana.peerId),
    ).toMatchObject({
      audioEnabled: false,
      videoEnabled: false,
    });
  });

  it('starts with the camera off for people who join with audio only', () => {
    const registry = createRoomRegistry();
    join(registry, 'ana');
    const ben = join(registry, 'ben', { media: 'audio' });
    const cleo = join(registry, 'cleo');
    expect(
      cleo.result.status === 'joined' && cleo.result.peers.find((peer) => peer.id === ben.peerId),
    ).toMatchObject({
      media: 'audio',
      videoEnabled: false,
    });
  });

  it('ignores a peer that is not in a room', () => {
    expect(() => createRoomRegistry().setMediaState('ghost', true, true)).not.toThrow();
  });
});

describe('removing people and ending meetings', () => {
  it('removes every connection of a user from one meeting, telling them why and the others who left', () => {
    const registry = createRoomRegistry();
    const target = join(registry, 'target');
    const other = join(registry, 'other');
    const elsewhere = join(registry, 'target', { meetingId: 'meeting-2' });

    expect(registry.kickUser('meeting-1', 'target', 'removed', 4002)).toBe(1);
    expect(target.connection.sent).toContainEqual({ type: 'bye', reason: 'removed' });
    expect(target.connection.closedWith).toEqual([4002]);
    expect(other.connection.sent).toContainEqual({ type: 'peer-left', peerId: target.peerId });
    expect(elsewhere.connection.closedWith).toEqual([]); // another meeting is untouched
    expect(registry.peerCount('meeting-1')).toBe(1);
  });

  it('removes nobody when the user is not in the room', () => {
    const registry = createRoomRegistry();
    join(registry, 'ana');
    expect(registry.kickUser('meeting-1', 'stranger', 'removed', 4002)).toBe(0);
    expect(registry.kickUser('no-such-meeting', 'ana', 'removed', 4002)).toBe(0);
  });

  it('disconnects everyone when a meeting ends, and only that meeting', () => {
    const registry = createRoomRegistry();
    const a = join(registry, 'a');
    const b = join(registry, 'b');
    const other = join(registry, 'c', { meetingId: 'meeting-2' });

    expect(registry.closeMeeting('meeting-1', 'meeting_cancelled', 4003)).toBe(2);
    for (const connection of [a.connection, b.connection]) {
      expect(connection.sent).toContainEqual({ type: 'bye', reason: 'meeting_cancelled' });
      expect(connection.closedWith).toEqual([4003]);
    }
    expect(registry.peerCount('meeting-1')).toBe(0);
    expect(other.connection.closedWith).toEqual([]);
    expect(
      registry.relay(a.peerId, b.peerId, (from) => ({ type: 'offer', from, sdp: 'v=0' })),
    ).toBe('unknown_peer');
  });

  it('can close every room at once, for shutdown', () => {
    const registry = createRoomRegistry();
    const a = join(registry, 'a', { meetingId: 'm1' });
    const b = join(registry, 'b', { meetingId: 'm2' });
    registry.closeAll('server_shutdown', 1001);
    expect(a.connection.closedWith).toEqual([1001]);
    expect(b.connection.closedWith).toEqual([1001]);
    expect(registry.roomCount()).toBe(0);
  });
});
