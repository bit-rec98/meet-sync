import { z } from 'zod';
import { MAX_CANDIDATE_LENGTH, MAX_SDP_LENGTH } from './limits.js';

// Every object is strict: a field that is not part of the protocol makes the message invalid.
// That includes a client-supplied `from`, which only the server may set.

export const MEDIA = ['audio', 'video'] as const;
export const mediaSchema = z.enum(MEDIA);
export type Media = z.infer<typeof mediaSchema>;

/** Peers are identified by an id the server generates for each connection. */
const peerIdSchema = z.uuid();
const sdpSchema = z.string().min(1).max(MAX_SDP_LENGTH);

/** The JSON form of an RTCIceCandidateInit. An empty `candidate` marks the end of candidates. */
export const iceCandidateSchema = z.strictObject({
  candidate: z.string().max(MAX_CANDIDATE_LENGTH),
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});
export type IceCandidate = z.infer<typeof iceCandidateSchema>;

// --- Client to server ---------------------------------------------------------------------------

export const clientMessageSchema = z.discriminatedUnion('type', [
  /** Enter the meeting's room. `media` is what this participant will send. */
  z.strictObject({ type: z.literal('join'), media: mediaSchema }),
  z.strictObject({ type: z.literal('leave') }),
  /** The next three are relayed to the peer `to`, which receives them with `from` set by the server. */
  z.strictObject({ type: z.literal('offer'), to: peerIdSchema, sdp: sdpSchema }),
  z.strictObject({ type: z.literal('answer'), to: peerIdSchema, sdp: sdpSchema }),
  z.strictObject({
    type: z.literal('ice-candidate'),
    to: peerIdSchema,
    candidate: iceCandidateSchema,
  }),
  /** Mute and camera state, for the other participants' interface. */
  z.strictObject({
    type: z.literal('media-state'),
    audioEnabled: z.boolean(),
    videoEnabled: z.boolean(),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// --- Server to client ---------------------------------------------------------------------------

export const peerSchema = z.strictObject({
  id: peerIdSchema,
  displayName: z.string(),
  media: mediaSchema,
  audioEnabled: z.boolean(),
  videoEnabled: z.boolean(),
});
export type Peer = z.infer<typeof peerSchema>;

export const ERROR_CODES = [
  /** The message was not valid. The server closes the connection after sending it. */
  'invalid_message',
  'not_joined',
  'already_joined',
  /** An audio meeting cannot be joined with video. */
  'invalid_media',
  'room_full',
  /** The user may not join the meeting right now. */
  'not_allowed',
  /** `to` is not a participant of this room. */
  'unknown_peer',
  /** Too many messages. The server closes the connection after sending it. */
  'rate_limited',
  /** Something failed on the server's side. The server closes the connection after sending it. */
  'server_error',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const BYE_REASONS = ['replaced', 'removed', 'meeting_cancelled', 'server_shutdown'] as const;
export const byeReasonSchema = z.enum(BYE_REASONS);
export type ByeReason = z.infer<typeof byeReasonSchema>;

export const serverMessageSchema = z.discriminatedUnion('type', [
  /** Answer to `join`: this connection's peer id and the participants already in the room. */
  z.strictObject({ type: z.literal('joined'), selfId: peerIdSchema, peers: z.array(peerSchema) }),
  z.strictObject({ type: z.literal('peer-joined'), peer: peerSchema }),
  z.strictObject({ type: z.literal('peer-left'), peerId: peerIdSchema }),
  z.strictObject({
    type: z.literal('peer-media-state'),
    peerId: peerIdSchema,
    audioEnabled: z.boolean(),
    videoEnabled: z.boolean(),
  }),
  z.strictObject({ type: z.literal('offer'), from: peerIdSchema, sdp: sdpSchema }),
  z.strictObject({ type: z.literal('answer'), from: peerIdSchema, sdp: sdpSchema }),
  z.strictObject({
    type: z.literal('ice-candidate'),
    from: peerIdSchema,
    candidate: iceCandidateSchema,
  }),
  /** The server is about to close the connection, and says why. */
  z.strictObject({ type: z.literal('bye'), reason: byeReasonSchema }),
  z.strictObject({ type: z.literal('error'), code: errorCodeSchema }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// --- Parsing ------------------------------------------------------------------------------------

function parseWith<S extends z.ZodType>(schema: S, text: string): z.output<S> | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : null;
}

/** Parses a message received from a client. Returns null for anything that is not valid. */
export const parseClientMessage = (text: string): ClientMessage | null =>
  parseWith(clientMessageSchema, text);

/** Parses a message received from the server. Returns null for anything that is not valid. */
export const parseServerMessage = (text: string): ServerMessage | null =>
  parseWith(serverMessageSchema, text);
