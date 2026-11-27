import { randomUUID } from 'node:crypto';
import type { ByeReason, Media, Peer, ServerMessage } from '@meet-sync/signaling-protocol';

/** What the registry needs from a connection. The WebSocket gateway provides it. */
export type PeerConnection = {
  send(message: ServerMessage): void;
  close(code: number): void;
};

export type JoinRequest = {
  meetingId: string;
  userId: string;
  displayName: string;
  media: Media;
  /** Largest number of peers the room may hold, decided by the meeting's call type. */
  capacity: number;
  connection: PeerConnection;
  /** Close code used for an older connection of the same user that this one replaces. */
  replacedCloseCode: number;
};

export type JoinResult =
  { status: 'joined'; peerId: string; peers: Peer[] } | { status: 'room_full' };

export type RelayResult = 'sent' | 'unknown_peer';

type RoomPeer = { info: Peer; userId: string; connection: PeerConnection };

/**
 * Who is in which meeting's room, and who may talk to whom. Pure logic with no sockets, so the
 * rules that keep meetings apart can be tested exhaustively.
 *
 * Rules:
 * - a message is only ever delivered to a peer of the same room as the sender;
 * - the sender id of a relayed message is the registry's own record, never anything the client said;
 * - a user has at most one peer per room: joining again replaces the older one;
 * - a room never holds more peers than its capacity.
 */
export function createRoomRegistry() {
  const rooms = new Map<string, Map<string, RoomPeer>>(); // meetingId -> peerId -> peer
  const meetingOfPeer = new Map<string, string>(); // peerId -> meetingId

  function remove(peerId: string): { peer: RoomPeer; meetingId: string } | null {
    const meetingId = meetingOfPeer.get(peerId);
    if (meetingId === undefined) return null;
    meetingOfPeer.delete(peerId);
    const room = rooms.get(meetingId);
    const peer = room?.get(peerId);
    if (!room || !peer) return null;
    room.delete(peerId);
    if (room.size === 0) rooms.delete(meetingId);
    return { peer, meetingId };
  }

  function broadcast(meetingId: string, message: ServerMessage, exceptPeerId?: string): void {
    for (const [peerId, peer] of rooms.get(meetingId) ?? []) {
      if (peerId !== exceptPeerId) peer.connection.send(message);
    }
  }

  /** Removes a peer on the server's initiative: tells it why, closes it, and tells the others. */
  function evict(peerId: string, reason: ByeReason, closeCode: number): void {
    const removed = remove(peerId);
    if (!removed) return;
    removed.peer.connection.send({ type: 'bye', reason });
    removed.peer.connection.close(closeCode);
    broadcast(removed.meetingId, { type: 'peer-left', peerId });
  }

  return {
    join(request: JoinRequest): JoinResult {
      // One peer per user and room: the same person coming back (a second tab, a reconnect after a
      // dropped connection) replaces the old connection instead of taking a second place.
      for (const [peerId, peer] of rooms.get(request.meetingId) ?? []) {
        if (peer.userId === request.userId) {
          evict(peerId, 'replaced', request.replacedCloseCode);
        }
      }

      const room = rooms.get(request.meetingId) ?? new Map<string, RoomPeer>();
      if (room.size >= request.capacity) return { status: 'room_full' };

      const peers = [...room.values()].map((peer) => ({ ...peer.info }));
      const info: Peer = {
        id: randomUUID(),
        displayName: request.displayName,
        media: request.media,
        audioEnabled: true,
        videoEnabled: request.media === 'video',
      };
      room.set(info.id, { info, userId: request.userId, connection: request.connection });
      rooms.set(request.meetingId, room);
      meetingOfPeer.set(info.id, request.meetingId);

      broadcast(request.meetingId, { type: 'peer-joined', peer: { ...info } }, info.id);
      return { status: 'joined', peerId: info.id, peers };
    },

    /** The peer left or its connection ended. Safe to call more than once. */
    leave(peerId: string): boolean {
      const removed = remove(peerId);
      if (!removed) return false;
      broadcast(removed.meetingId, { type: 'peer-left', peerId });
      return true;
    },

    /**
     * Delivers a message from one peer to another in the same room. `build` receives the sender's
     * id as the registry knows it.
     */
    relay(
      fromPeerId: string,
      toPeerId: string,
      build: (from: string) => ServerMessage,
    ): RelayResult {
      const meetingId = meetingOfPeer.get(fromPeerId);
      if (meetingId === undefined || toPeerId === fromPeerId) return 'unknown_peer';
      const target = rooms.get(meetingId)?.get(toPeerId);
      if (!target) return 'unknown_peer';
      target.connection.send(build(fromPeerId));
      return 'sent';
    },

    setMediaState(peerId: string, audioEnabled: boolean, videoEnabled: boolean): void {
      const meetingId = meetingOfPeer.get(peerId);
      const peer = meetingId === undefined ? undefined : rooms.get(meetingId)?.get(peerId);
      if (meetingId === undefined || !peer) return;
      peer.info.audioEnabled = audioEnabled;
      peer.info.videoEnabled = videoEnabled;
      broadcast(
        meetingId,
        { type: 'peer-media-state', peerId, audioEnabled, videoEnabled },
        peerId,
      );
    },

    /** Removes every peer of a user from a meeting's room. Returns how many were removed. */
    kickUser(meetingId: string, userId: string, reason: ByeReason, closeCode: number): number {
      const targets = [...(rooms.get(meetingId) ?? [])]
        .filter(([, peer]) => peer.userId === userId)
        .map(([peerId]) => peerId);
      for (const peerId of targets) evict(peerId, reason, closeCode);
      return targets.length;
    },

    /** Ends the room: everyone is told why and disconnected. Returns how many were removed. */
    closeMeeting(meetingId: string, reason: ByeReason, closeCode: number): number {
      const room = rooms.get(meetingId);
      if (!room) return 0;
      const everyone = [...room.entries()];
      for (const [peerId] of everyone) {
        meetingOfPeer.delete(peerId);
      }
      rooms.delete(meetingId);
      for (const [, peer] of everyone) {
        peer.connection.send({ type: 'bye', reason });
        peer.connection.close(closeCode);
      }
      return everyone.length;
    },

    closeAll(reason: ByeReason, closeCode: number): void {
      for (const meetingId of [...rooms.keys()]) this.closeMeeting(meetingId, reason, closeCode);
    },

    peerCount: (meetingId: string): number => rooms.get(meetingId)?.size ?? 0,
    roomCount: (): number => rooms.size,
  };
}

export type RoomRegistry = ReturnType<typeof createRoomRegistry>;
