import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  CLOSE_CODES,
  MAX_MESSAGE_BYTES,
  SIGNALING_PATH,
  parseClientMessage,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from '@meet-sync/signaling-protocol';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { DomainError } from '../errors.js';
import type { Logger } from '../http/logger.js';
import type { MeetingEvents } from '../meetingEvents.js';
import { createRoomRegistry, type PeerConnection } from './rooms.js';
import type { TicketData, TicketStore } from './tickets.js';
import { createTokenBucket } from './tokenBucket.js';

export type SignalingOptions = {
  /** How often silent connections are pinged; one that missed a whole interval is dropped. */
  heartbeatIntervalMs: number;
  /** A connection must send `join` within this time. */
  joinTimeoutMs: number;
  maxConnections: number;
  /** Per-connection message rate: a burst of `capacity`, refilled `refillPerSecond` a second. */
  rateLimit: { capacity: number; refillPerSecond: number };
};

const DEFAULT_OPTIONS: SignalingOptions = {
  heartbeatIntervalMs: 30_000,
  joinTimeoutMs: 10_000,
  maxConnections: 1000,
  // Connecting two peers sends dozens of candidates at once; nine peers do it nine times.
  rateLimit: { capacity: 400, refillPerSecond: 200 },
};

export type SignalingDependencies = {
  httpServer: HttpServer;
  tickets: TicketStore;
  /**
   * Decides, at the moment of joining, whether the user may be in the meeting (host or invitee,
   * scheduled, inside the join window). Throws a DomainError when not. Returns the call type.
   */
  authorizeJoin: (userId: string, meetingId: string) => Promise<{ callType: 'audio' | 'video' }>;
  events: MeetingEvents;
  /** Origins allowed to open a connection from a browser. */
  webOrigins: readonly string[];
  maxParticipants: { audio: number; video: number };
  log: Logger;
  options?: Partial<SignalingOptions>;
};

export type Signaling = {
  /** Disconnects everyone politely and stops accepting connections. */
  close(): Promise<void>;
  connectionCount(): number;
};

const HTTP_STATUS_TEXT: Record<number, string> = {
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  503: 'Service Unavailable',
};

/** Short, fixed explanations sent in the close frame. */
const CLOSE_REASONS: Record<number, string> = {
  [CLOSE_CODES.normal]: 'left',
  [CLOSE_CODES.goingAway]: 'server shutting down',
  [CLOSE_CODES.policyViolation]: 'policy violation',
  [CLOSE_CODES.internalError]: 'server error',
  [CLOSE_CODES.replaced]: 'replaced',
  [CLOSE_CODES.removed]: 'removed',
  [CLOSE_CODES.meetingCancelled]: 'meeting cancelled',
  [CLOSE_CODES.notAllowed]: 'not allowed',
  [CLOSE_CODES.roomFull]: 'room full',
};

type ConnectionState = {
  id: string;
  ticket: TicketData;
  ws: WebSocket;
  peerId: string | null;
  joining: boolean;
  closed: boolean;
  alive: boolean;
};

function rawToText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

/**
 * The WebSocket side of signaling. A browser first gets a single-use ticket over HTTP, then opens
 * `/api/v1/ws?ticket=...`. The gateway only relays: it checks who may join, keeps meetings apart,
 * and never reads media or interprets session descriptions.
 */
export function createSignaling(dependencies: SignalingDependencies): Signaling {
  const { httpServer, tickets, authorizeJoin, events, webOrigins, maxParticipants, log } =
    dependencies;
  const options: SignalingOptions = { ...DEFAULT_OPTIONS, ...dependencies.options };

  const registry = createRoomRegistry();
  const connections = new Set<ConnectionState>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES, // larger messages close the connection with code 1009
    perMessageDeflate: false, // no compression: it costs CPU and is a classic amplification risk
    clientTracking: false,
  });

  function sendMessage(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function closeSocket(ws: WebSocket, code: number): void {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(code, CLOSE_REASONS[code] ?? 'closed');
    }
  }

  // --- Opening a connection ---------------------------------------------------------------------

  function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
    log({ event: 'ws_rejected', reason, status });
    socket.write(
      `HTTP/1.1 ${status} ${HTTP_STATUS_TEXT[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    socket.destroy();
  }

  function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => undefined); // a socket that fails while upgrading must not crash the process

    // Only the query string is read here; it carries the ticket, so it is never logged.
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== SIGNALING_PATH) {
      rejectUpgrade(socket, 404, 'wrong_path');
      return;
    }
    // Browsers always send Origin. A page of another site must not be able to open this socket.
    // Non-browser clients send none, and they still need a valid ticket.
    const origin = request.headers.origin;
    if (origin !== undefined && !webOrigins.includes(origin)) {
      rejectUpgrade(socket, 403, 'origin_not_allowed');
      return;
    }
    const ticket = tickets.consume(url.searchParams.get('ticket') ?? '');
    if (!ticket) {
      rejectUpgrade(socket, 401, 'invalid_ticket');
      return;
    }
    if (connections.size >= options.maxConnections) {
      rejectUpgrade(socket, 503, 'too_many_connections');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => onConnection(ws, ticket));
  }

  // --- One connection --------------------------------------------------------------------------

  function onConnection(ws: WebSocket, ticket: TicketData): void {
    const state: ConnectionState = {
      id: randomUUID(),
      ticket,
      ws,
      peerId: null,
      joining: false,
      closed: false,
      alive: true,
    };
    connections.add(state);
    log({
      event: 'ws_connected',
      connectionId: state.id,
      userId: ticket.userId,
      meetingId: ticket.meetingId,
    });

    const bucket = createTokenBucket({ ...options.rateLimit, now: Date.now });
    const peerConnection: PeerConnection = {
      send: (message) => sendMessage(ws, message),
      close: (code) => closeSocket(ws, code),
    };

    const joinTimer = setTimeout(() => {
      if (state.peerId === null) closeSocket(ws, CLOSE_CODES.policyViolation);
    }, options.joinTimeoutMs);
    joinTimer.unref();

    function fail(code: ErrorCode, closeCode?: number): void {
      sendMessage(ws, { type: 'error', code });
      if (closeCode !== undefined) closeSocket(ws, closeCode);
    }

    async function join(media: 'audio' | 'video'): Promise<void> {
      if (state.peerId !== null || state.joining) return fail('already_joined');
      state.joining = true;
      try {
        // The ticket is up to 30 seconds old; access is checked again now.
        let meeting: { callType: 'audio' | 'video' };
        try {
          meeting = await authorizeJoin(ticket.userId, ticket.meetingId);
        } catch (error) {
          if (error instanceof DomainError) return fail('not_allowed', CLOSE_CODES.notAllowed);
          throw error;
        }
        if (state.closed) return;
        if (meeting.callType === 'audio' && media === 'video') return fail('invalid_media');

        const result = registry.join({
          meetingId: ticket.meetingId,
          userId: ticket.userId,
          displayName: ticket.displayName,
          media,
          capacity: maxParticipants[meeting.callType],
          connection: peerConnection,
          replacedCloseCode: CLOSE_CODES.replaced,
        });
        if (result.status === 'room_full') return fail('room_full', CLOSE_CODES.roomFull);

        state.peerId = result.peerId;
        clearTimeout(joinTimer);
        sendMessage(ws, { type: 'joined', selfId: result.peerId, peers: result.peers });
        log({
          event: 'ws_joined',
          connectionId: state.id,
          userId: ticket.userId,
          meetingId: ticket.meetingId,
          peerId: result.peerId,
          media,
        });
      } finally {
        state.joining = false;
      }
    }

    async function handle(message: ClientMessage): Promise<void> {
      if (message.type === 'join') return join(message.media);
      const peerId = state.peerId;
      if (peerId === null) return fail('not_joined');

      switch (message.type) {
        case 'leave':
          registry.leave(peerId);
          state.peerId = null;
          closeSocket(ws, CLOSE_CODES.normal);
          return;
        case 'media-state':
          registry.setMediaState(peerId, message.audioEnabled, message.videoEnabled);
          return;
        case 'offer':
        case 'answer': {
          const { type, sdp } = message;
          const result = registry.relay(peerId, message.to, (from) => ({ type, from, sdp }));
          if (result === 'unknown_peer') fail('unknown_peer');
          return;
        }
        case 'ice-candidate': {
          const { candidate } = message;
          const result = registry.relay(peerId, message.to, (from) => ({
            type: 'ice-candidate',
            from,
            candidate,
          }));
          if (result === 'unknown_peer') fail('unknown_peer');
          return;
        }
      }
    }

    ws.on('message', (data, isBinary) => {
      if (!bucket.tryTake()) return fail('rate_limited', CLOSE_CODES.policyViolation);
      // The protocol is JSON text only. Anything else is not from a client that follows it.
      const message = isBinary ? null : parseClientMessage(rawToText(data));
      if (!message) return fail('invalid_message', CLOSE_CODES.policyViolation);

      handle(message).catch((error: unknown) => {
        log({
          event: 'ws_error',
          connectionId: state.id,
          errorName: error instanceof Error ? error.name : 'unknown',
        });
        fail('server_error', CLOSE_CODES.internalError);
      });
    });

    ws.on('pong', () => {
      state.alive = true;
    });

    // Errors such as a message over the size limit are followed by a close event; handle both.
    ws.on('error', () => undefined);

    ws.on('close', (code) => {
      state.closed = true;
      clearTimeout(joinTimer);
      connections.delete(state);
      if (state.peerId !== null) registry.leave(state.peerId);
      log({
        event: 'ws_closed',
        connectionId: state.id,
        userId: ticket.userId,
        meetingId: ticket.meetingId,
        code,
      });
    });
  }

  // --- Server-wide: heartbeat, events from the REST API, shutdown -------------------------------

  const heartbeat = setInterval(() => {
    for (const state of connections) {
      if (!state.alive) {
        state.ws.terminate(); // no answer to the last ping: the peer is gone
        continue;
      }
      state.alive = false;
      if (state.ws.readyState === WebSocket.OPEN) state.ws.ping();
    }
  }, options.heartbeatIntervalMs);
  heartbeat.unref();

  events.onMeetingCancelled((meetingId) => {
    registry.closeMeeting(meetingId, 'meeting_cancelled', CLOSE_CODES.meetingCancelled);
  });
  events.onInviteeRemoved((meetingId, userId) => {
    registry.kickUser(meetingId, userId, 'removed', CLOSE_CODES.removed);
  });

  httpServer.on('upgrade', handleUpgrade);

  return {
    connectionCount: () => connections.size,

    async close() {
      httpServer.off('upgrade', handleUpgrade);
      clearInterval(heartbeat);
      registry.closeAll('server_shutdown', CLOSE_CODES.goingAway);
      for (const state of connections) closeSocket(state.ws, CLOSE_CODES.goingAway);

      // Give clients a moment to answer the close frame, then cut whatever is left.
      const deadline = Date.now() + 1000;
      while (connections.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      for (const state of connections) state.ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
