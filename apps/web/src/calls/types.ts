import type { ClientMessage, IceServer, Media, ServerMessage } from '@meet-sync/signaling-protocol';

// --- The browser's objects, as the call logic needs them ------------------------------------------
// Small structural interfaces: the real MediaStream and RTCPeerConnection satisfy them, and tests
// provide fakes (jsdom has neither camera nor WebRTC).

export interface TrackLike {
  readonly kind: string;
  enabled: boolean;
  stop(): void;
}

export interface StreamLike {
  getTracks(): TrackLike[];
  getAudioTracks(): TrackLike[];
  getVideoTracks(): TrackLike[];
}

export type IceCandidateInit = {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export interface SenderLike {
  readonly track: TrackLike | null;
  getParameters(): { encodings?: { maxBitrate?: number }[] };
  setParameters(parameters: { encodings?: { maxBitrate?: number }[] }): Promise<void>;
}

export interface PeerConnectionLike {
  addTrack(track: TrackLike, stream: StreamLike): unknown;
  createOffer(): Promise<{ sdp?: string }>;
  createAnswer(): Promise<{ sdp?: string }>;
  setLocalDescription(description: { type: 'offer' | 'answer'; sdp?: string }): Promise<void>;
  setRemoteDescription(description: { type: 'offer' | 'answer'; sdp: string }): Promise<void>;
  addIceCandidate(candidate: IceCandidateInit): Promise<void>;
  getSenders(): SenderLike[];
  close(): void;
  readonly connectionState: string;
  onicecandidate: ((event: { candidate: { toJSON(): IceCandidateInit } | null }) => void) | null;
  ontrack: ((event: { track: TrackLike; streams: readonly StreamLike[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
}

/** A connection to the signaling server, already open. */
export interface SignalingChannel {
  send(message: ClientMessage): void;
  close(): void;
  onMessage: ((message: ServerMessage) => void) | null;
  /** `code` is the WebSocket close code (1006 when the connection dropped without one). */
  onClose: ((event: { code: number }) => void) | null;
}

/** Everything the call logic needs from the browser. The app uses the real ones; tests use fakes. */
export type CallEnvironment = {
  getUserMedia(constraints: { audio: unknown; video: unknown }): Promise<StreamLike>;
  createPeerConnection(configuration: { iceServers: IceServer[] }): PeerConnectionLike;
  /** Opens the signaling WebSocket for a ticket. Rejects if it cannot be opened. */
  openSignaling(ticket: string): Promise<SignalingChannel>;
};

// --- What the screen shows ------------------------------------------------------------------------

/** Why the call could not start; the user can try again from the lobby. */
export type StartFailure =
  | 'permission_denied'
  | 'no_device'
  | 'media_failed'
  | 'not_available'
  | 'rate_limited'
  | 'network'
  | 'unexpected';

/** Why a call that was running (or being joined) ended. */
export type EndReason =
  | 'left'
  | 'replaced'
  | 'removed'
  | 'meeting_cancelled'
  | 'server_shutdown'
  | 'connection_lost'
  | 'not_allowed'
  | 'room_full';

export type PeerConnectionStatus = 'connecting' | 'connected' | 'failed';

export type PeerView = {
  id: string;
  displayName: string;
  media: Media;
  audioEnabled: boolean;
  videoEnabled: boolean;
  /** The stream received from this peer; null until the first track arrives. */
  stream: StreamLike | null;
  connection: PeerConnectionStatus;
};

export type CallPhase = 'lobby' | 'starting' | 'in-call' | 'ended';

/** Something that happened in the room, for announcing to people who cannot see the screen. */
export type RoomEvent = { id: number; kind: 'joined' | 'left'; name: string };

export type CallState = {
  phase: CallPhase;
  /** What the user chose to send; null before starting. */
  media: Media | null;
  peers: PeerView[];
  localStream: StreamLike | null;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  /** Whether the user is sending video at all (a camera track exists). */
  hasCamera: boolean;
  /** Set in the lobby after a failed start. */
  startFailure: StartFailure | null;
  /** Set when the phase is `ended`. */
  endReason: EndReason | null;
  lastRoomEvent: RoomEvent | null;
};

export type CallSession = {
  getState(): CallState;
  subscribe(listener: () => void): () => void;
  /** Gets camera/microphone access, a ticket and ICE servers, connects, and joins the room. */
  start(media: Media): Promise<void>;
  toggleMicrophone(): void;
  toggleCamera(): void;
  /** The user ends the call. */
  leave(): void;
  /** The screen went away: ends everything quietly. Safe to call more than once. */
  dispose(): void;
};
