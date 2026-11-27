import type { ClientMessage, IceServer, ServerMessage } from '@meet-sync/signaling-protocol';
import type {
  CallEnvironment,
  IceCandidateInit,
  PeerConnectionLike,
  SenderLike,
  SignalingChannel,
  StreamLike,
  TrackLike,
} from '../calls/types';

/** Stand-ins for the browser's camera, microphone and WebRTC, for tests (jsdom has none of them). */

export class FakeTrack implements TrackLike {
  enabled = true;
  stopped = false;
  constructor(readonly kind: 'audio' | 'video') {}
  stop(): void {
    this.stopped = true;
  }
}

export class FakeStream implements StreamLike {
  readonly tracks: FakeTrack[];
  constructor(kinds: ('audio' | 'video')[] = ['audio', 'video']) {
    this.tracks = kinds.map((kind) => new FakeTrack(kind));
  }
  getTracks = (): FakeTrack[] => this.tracks;
  getAudioTracks = (): FakeTrack[] => this.tracks.filter((track) => track.kind === 'audio');
  getVideoTracks = (): FakeTrack[] => this.tracks.filter((track) => track.kind === 'video');
}

export class FakeSender implements SenderLike {
  parameters: { encodings?: { maxBitrate?: number }[] } = { encodings: [{}] };
  readonly setCalls: { encodings?: { maxBitrate?: number }[] }[] = [];
  constructor(readonly track: TrackLike) {}
  getParameters = () => this.parameters;
  async setParameters(parameters: { encodings?: { maxBitrate?: number }[] }): Promise<void> {
    this.setCalls.push(structuredClone(parameters));
    this.parameters = parameters;
  }
}

export class FakePeerConnection implements PeerConnectionLike {
  readonly addedTracks: TrackLike[] = [];
  readonly senders: FakeSender[] = [];
  readonly addedCandidates: IceCandidateInit[] = [];
  localDescription: { type: string; sdp?: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  closed = false;
  connectionState = 'new';
  failOffer = false;
  onicecandidate: PeerConnectionLike['onicecandidate'] = null;
  ontrack: PeerConnectionLike['ontrack'] = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor(
    readonly configuration: { iceServers: IceServer[] },
    readonly index: number,
  ) {}

  addTrack(track: TrackLike): unknown {
    this.addedTracks.push(track);
    const sender = new FakeSender(track);
    this.senders.push(sender);
    return sender;
  }
  async createOffer(): Promise<{ sdp?: string }> {
    if (this.failOffer) throw new Error('cannot create an offer');
    return { sdp: `offer-from-connection-${this.index}` };
  }
  async createAnswer(): Promise<{ sdp?: string }> {
    return { sdp: `answer-from-connection-${this.index}` };
  }
  async setLocalDescription(description: {
    type: 'offer' | 'answer';
    sdp?: string;
  }): Promise<void> {
    this.localDescription = description;
  }
  async setRemoteDescription(description: {
    type: 'offer' | 'answer';
    sdp: string;
  }): Promise<void> {
    this.remoteDescription = description;
  }
  async addIceCandidate(candidate: IceCandidateInit): Promise<void> {
    // The browser refuses candidates before the remote description is set; so does this fake.
    if (!this.remoteDescription) throw new Error('No remote description yet');
    this.addedCandidates.push(candidate);
  }
  getSenders = (): FakeSender[] => this.senders;
  close(): void {
    this.closed = true;
  }

  // Helpers for tests to make the "browser" do things.
  emitLocalCandidate(candidate: IceCandidateInit | null): void {
    this.onicecandidate?.({ candidate: candidate ? { toJSON: () => candidate } : null });
  }
  emitRemoteStream(stream: StreamLike): void {
    this.ontrack?.({ track: stream.getTracks()[0] as TrackLike, streams: [stream] });
  }
  setConnectionState(state: string): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

export class FakeChannel implements SignalingChannel {
  readonly sent: ClientMessage[] = [];
  closed = false;
  onMessage: SignalingChannel['onMessage'] = null;
  onClose: SignalingChannel['onClose'] = null;
  send(message: ClientMessage): void {
    this.sent.push(message);
  }
  close(): void {
    this.closed = true;
  }
  /** The server sends a message. */
  emit(message: ServerMessage): void {
    this.onMessage?.(message);
  }
  /** The connection ends. */
  emitClose(code: number): void {
    this.onClose?.({ code });
  }
  sentOfType<T extends ClientMessage['type']>(type: T): Extract<ClientMessage, { type: T }>[] {
    return this.sent.filter(
      (message): message is Extract<ClientMessage, { type: T }> => message.type === type,
    );
  }
}

export type FakeEnvironment = CallEnvironment & {
  connections: FakePeerConnection[];
  channel: FakeChannel;
  streams: FakeStream[];
  mediaRequests: { audio: unknown; video: unknown }[];
  tickets: string[];
  /** Make the next call to `getUserMedia` fail. */
  failMedia(error: unknown): void;
  failSignaling(): void;
};

export function createFakeEnvironment(): FakeEnvironment {
  const channel = new FakeChannel();
  let mediaError: unknown = null;
  let signalingFails = false;

  const environment: FakeEnvironment = {
    connections: [],
    channel,
    streams: [],
    mediaRequests: [],
    tickets: [],
    failMedia: (error) => void (mediaError = error),
    failSignaling: () => void (signalingFails = true),

    async getUserMedia(constraints) {
      environment.mediaRequests.push(constraints);
      if (mediaError) {
        const error = mediaError;
        mediaError = null;
        throw error;
      }
      const stream = new FakeStream(constraints.video ? ['audio', 'video'] : ['audio']);
      environment.streams.push(stream);
      return stream;
    },
    createPeerConnection(configuration) {
      const connection = new FakePeerConnection(configuration, environment.connections.length);
      environment.connections.push(connection);
      return connection;
    },
    async openSignaling(ticket) {
      environment.tickets.push(ticket);
      if (signalingFails) {
        signalingFails = false;
        throw new Error('cannot connect');
      }
      return channel;
    },
  };
  return environment;
}

export const PEER_A = '3f0e4b1c-6a52-4a67-9d5e-1f2a3b4c5d6e';
export const PEER_B = '8a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d';
export const PEER_C = 'c0ffee00-1111-4222-8333-444455556666';
export const SELF = 'a1b2c3d4-0000-4000-8000-000000000001';

export const peer = (id: string, displayName: string, media: 'audio' | 'video' = 'video') => ({
  id,
  displayName,
  media,
  audioEnabled: true,
  videoEnabled: media === 'video',
});
