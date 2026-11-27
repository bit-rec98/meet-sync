import type { IceServer, Media, Peer, ServerMessage } from '@meet-sync/signaling-protocol';
import { ApiError } from '../api/errors';
import { maxVideoBitrate } from './bitrate';
import { classifyMediaError, localMediaConstraints } from './media';
import type {
  CallEnvironment,
  CallSession,
  CallState,
  EndReason,
  IceCandidateInit,
  PeerConnectionLike,
  PeerConnectionStatus,
  PeerView,
  SignalingChannel,
  StartFailure,
  StreamLike,
} from './types';

export type CallSessionDependencies = {
  environment: CallEnvironment;
  api: {
    requestTicket(meetingId: string): Promise<{ ticket: string }>;
    iceServers(): Promise<IceServer[]>;
  };
  meetingId: string;
};

type PeerEntry = {
  info: Peer;
  pc: PeerConnectionLike;
  /** Candidates that arrived before the remote description; they cannot be added until it is set. */
  pendingCandidates: IceCandidateInit[];
  hasRemoteDescription: boolean;
  stream: StreamLike | null;
  connection: PeerConnectionStatus;
};

/** What the screen shows before anything has happened: the lobby. */
export const INITIAL_STATE: CallState = {
  phase: 'lobby',
  media: null,
  peers: [],
  localStream: null,
  microphoneEnabled: true,
  cameraEnabled: true,
  hasCamera: false,
  startFailure: null,
  endReason: null,
  lastRoomEvent: null,
};

// What the server's close codes mean, for when the connection closes without a preceding message.
const END_REASON_BY_CLOSE_CODE: Record<number, EndReason> = {
  1001: 'server_shutdown',
  4001: 'replaced',
  4002: 'removed',
  4003: 'meeting_cancelled',
  4004: 'not_allowed',
  4005: 'room_full',
};

function startFailureFor(error: unknown): StartFailure {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'not_found':
      case 'invalid_state':
      case 'forbidden':
        return 'not_available';
      case 'rate_limited':
        return 'rate_limited';
      case 'network_error':
        return 'network';
    }
  }
  return 'unexpected';
}

const connectionStatusFor = (state: string): PeerConnectionStatus => {
  if (state === 'connected') return 'connected';
  if (state === 'failed') return 'failed';
  return 'connecting'; // new, connecting, disconnected (may recover) and closed (about to be removed)
};

/** Candidates as the protocol defines them: a text, and optional fields only when present. */
function toProtocolCandidate(candidate: IceCandidateInit) {
  return {
    candidate: candidate.candidate ?? '',
    ...(candidate.sdpMid === undefined ? {} : { sdpMid: candidate.sdpMid }),
    ...(candidate.sdpMLineIndex === undefined ? {} : { sdpMLineIndex: candidate.sdpMLineIndex }),
    ...(candidate.usernameFragment === undefined
      ? {}
      : { usernameFragment: candidate.usernameFragment }),
  };
}

const stopStream = (stream: StreamLike | null): void => {
  for (const track of stream?.getTracks() ?? []) track.stop();
};

/**
 * One person's participation in one meeting's call: camera and microphone, the signaling
 * connection, and a WebRTC connection to every other participant (a mesh).
 *
 * How connections are set up: the participant who just joined sends an offer to each person already
 * in the room, and the others only answer. Roles are therefore never ambiguous, and no offers cross.
 * There is no renegotiation: muting and turning the camera off change `track.enabled`.
 *
 * It is plain TypeScript with the browser's APIs passed in, so it can be tested without a browser.
 * The screen renders the immutable snapshots of {@link CallSession.getState}.
 */
export function createCallSession({
  environment,
  api,
  meetingId,
}: CallSessionDependencies): CallSession {
  let state: CallState = INITIAL_STATE;
  const listeners = new Set<() => void>();
  const peers = new Map<string, PeerEntry>();
  let channel: SignalingChannel | null = null;
  let localStream: StreamLike | null = null;
  let iceServers: IceServer[] = [];
  let disposed = false;
  let nextRoomEventId = 1;

  function update(patch: Partial<CallState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }

  function publishPeers(): void {
    const views: PeerView[] = [...peers.values()].map((entry) => ({
      id: entry.info.id,
      displayName: entry.info.displayName,
      media: entry.info.media,
      audioEnabled: entry.info.audioEnabled,
      videoEnabled: entry.info.videoEnabled,
      stream: entry.stream,
      connection: entry.connection,
    }));
    update({ peers: views });
  }

  function announce(kind: 'joined' | 'left', name: string): void {
    update({ lastRoomEvent: { id: nextRoomEventId++, kind, name } });
  }

  /** Releases everything the call holds, without changing what the screen shows. */
  function releaseResources(): void {
    for (const entry of peers.values()) {
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
    }
    peers.clear();
    stopStream(localStream);
    localStream = null;
    if (channel) {
      channel.onMessage = null;
      channel.onClose = null;
      channel.close();
      channel = null;
    }
  }

  function endCall(reason: EndReason): void {
    if (state.phase === 'ended') return;
    releaseResources();
    update({ phase: 'ended', endReason: reason, peers: [], localStream: null });
  }

  function failStart(reason: StartFailure): void {
    releaseResources();
    update({
      phase: 'lobby',
      media: null,
      startFailure: reason,
      peers: [],
      localStream: null,
    });
  }

  // --- Connections to the other participants ----------------------------------------------------

  /** Caps the video each connection sends, so a bigger room does not flood anyone's connection. */
  async function applyVideoBitrate(): Promise<void> {
    const ceiling = maxVideoBitrate(peers.size);
    for (const entry of peers.values()) {
      for (const sender of entry.pc.getSenders()) {
        if (sender.track?.kind !== 'video') continue;
        try {
          const parameters = sender.getParameters();
          const encodings = parameters.encodings?.length ? parameters.encodings : [{}];
          const first = encodings[0];
          if (first) first.maxBitrate = ceiling;
          await sender.setParameters({ ...parameters, encodings });
        } catch {
          // Not possible before negotiation finishes or on some browsers: the default applies.
        }
      }
    }
  }

  function markFailed(entry: PeerEntry): void {
    entry.connection = 'failed';
    publishPeers();
  }

  async function sendOffer(entry: PeerEntry): Promise<void> {
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription({ type: 'offer', ...(offer.sdp ? { sdp: offer.sdp } : {}) });
    if (offer.sdp) channel?.send({ type: 'offer', to: entry.info.id, sdp: offer.sdp });
  }

  async function flushCandidates(entry: PeerEntry): Promise<void> {
    entry.hasRemoteDescription = true;
    const pending = entry.pendingCandidates.splice(0);
    for (const candidate of pending) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch {
        // A candidate that does not fit is not fatal: others may still connect.
      }
    }
  }

  async function answerOffer(entry: PeerEntry, sdp: string): Promise<void> {
    await entry.pc.setRemoteDescription({ type: 'offer', sdp });
    await flushCandidates(entry);
    const answer = await entry.pc.createAnswer();
    await entry.pc.setLocalDescription({
      type: 'answer',
      ...(answer.sdp ? { sdp: answer.sdp } : {}),
    });
    if (answer.sdp) channel?.send({ type: 'answer', to: entry.info.id, sdp: answer.sdp });
    void applyVideoBitrate();
  }

  async function acceptAnswer(entry: PeerEntry, sdp: string): Promise<void> {
    await entry.pc.setRemoteDescription({ type: 'answer', sdp });
    await flushCandidates(entry);
    void applyVideoBitrate();
  }

  function addPeer(info: Peer, initiator: boolean): void {
    if (!localStream) return;
    peers.get(info.id)?.pc.close(); // never expected, but never leave a stray connection behind
    const pc = environment.createPeerConnection({ iceServers });
    const entry: PeerEntry = {
      info: { ...info },
      pc,
      pendingCandidates: [],
      hasRemoteDescription: false,
      stream: null,
      connection: 'connecting',
    };
    peers.set(info.id, entry);

    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return; // the end of candidates needs no message
      channel?.send({
        type: 'ice-candidate',
        to: info.id,
        candidate: toProtocolCandidate(event.candidate.toJSON()),
      });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      entry.stream = stream;
      publishPeers();
    };
    pc.onconnectionstatechange = () => {
      entry.connection = connectionStatusFor(pc.connectionState);
      publishPeers();
    };

    publishPeers();
    if (initiator) sendOffer(entry).catch(() => markFailed(entry));
    void applyVideoBitrate();
  }

  function removePeer(peerId: string): PeerEntry | null {
    const entry = peers.get(peerId);
    if (!entry) return null;
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.close();
    peers.delete(peerId);
    publishPeers();
    void applyVideoBitrate();
    return entry;
  }

  // --- Messages from the server ----------------------------------------------------------------

  function handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'joined': {
        if (state.phase !== 'starting' || !localStream) return;
        update({
          phase: 'in-call',
          localStream,
          microphoneEnabled: true,
          cameraEnabled: state.media === 'video',
          hasCamera: localStream.getVideoTracks().length > 0,
        });
        // The people already here are waiting for our offers.
        for (const peer of message.peers) addPeer(peer, true);
        return;
      }
      case 'peer-joined':
        addPeer(message.peer, false); // the newcomer will send the offer
        announce('joined', message.peer.displayName);
        return;
      case 'peer-left': {
        const entry = removePeer(message.peerId);
        if (entry) announce('left', entry.info.displayName);
        return;
      }
      case 'peer-media-state': {
        const entry = peers.get(message.peerId);
        if (!entry) return;
        entry.info.audioEnabled = message.audioEnabled;
        entry.info.videoEnabled = message.videoEnabled;
        publishPeers();
        return;
      }
      case 'offer': {
        const entry = peers.get(message.from);
        if (entry) answerOffer(entry, message.sdp).catch(() => markFailed(entry));
        return;
      }
      case 'answer': {
        const entry = peers.get(message.from);
        if (entry) acceptAnswer(entry, message.sdp).catch(() => markFailed(entry));
        return;
      }
      case 'ice-candidate': {
        const entry = peers.get(message.from);
        if (!entry) return;
        const candidate = message.candidate;
        if (!entry.hasRemoteDescription) {
          entry.pendingCandidates.push(candidate);
          return;
        }
        entry.pc.addIceCandidate(candidate).catch(() => undefined);
        return;
      }
      case 'bye':
        endCall(message.reason);
        return;
      case 'error':
        switch (message.code) {
          case 'not_allowed':
          case 'room_full':
            endCall(message.code);
            return;
          case 'invalid_media':
            failStart('unexpected');
            return;
          case 'unknown_peer':
          case 'not_joined':
          case 'already_joined':
            return; // a peer left while a message was on its way: nothing to do
          default:
            endCall('connection_lost'); // invalid_message, rate_limited, server_error
        }
    }
  }

  function handleClose(code: number): void {
    if (disposed || state.phase === 'ended') return;
    if (state.phase === 'starting') {
      failStart('network');
      return;
    }
    endCall(END_REASON_BY_CLOSE_CODE[code] ?? 'connection_lost');
  }

  // --- The session --------------------------------------------------------------------------------

  async function start(media: Media): Promise<void> {
    if (disposed || state.phase === 'starting' || state.phase === 'in-call') return;
    update({ phase: 'starting', media, startFailure: null, endReason: null });

    try {
      try {
        localStream = await environment.getUserMedia(localMediaConstraints(media));
      } catch (error) {
        failStart(classifyMediaError(error));
        return;
      }
      if (disposed) return releaseResources();
      update({ localStream });

      let ticket: string;
      try {
        [{ ticket }, iceServers] = await Promise.all([
          api.requestTicket(meetingId),
          api.iceServers(),
        ]);
      } catch (error) {
        failStart(startFailureFor(error));
        return;
      }
      if (disposed) return releaseResources();

      try {
        channel = await environment.openSignaling(ticket);
      } catch {
        failStart('network');
        return;
      }
      if (disposed) return releaseResources();

      channel.onMessage = handleMessage;
      channel.onClose = ({ code }) => handleClose(code);
      channel.send({ type: 'join', media });
    } catch {
      failStart('unexpected');
    }
  }

  function setLocalTracks(kind: 'audio' | 'video', enabled: boolean): void {
    const tracks = kind === 'audio' ? localStream?.getAudioTracks() : localStream?.getVideoTracks();
    for (const track of tracks ?? []) track.enabled = enabled;
  }

  function shareMediaState(): void {
    channel?.send({
      type: 'media-state',
      audioEnabled: state.microphoneEnabled,
      videoEnabled: state.hasCamera && state.cameraEnabled,
    });
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    start,

    toggleMicrophone() {
      if (state.phase !== 'in-call') return;
      const enabled = !state.microphoneEnabled;
      setLocalTracks('audio', enabled);
      update({ microphoneEnabled: enabled });
      shareMediaState();
    },

    toggleCamera() {
      if (state.phase !== 'in-call' || !state.hasCamera) return;
      const enabled = !state.cameraEnabled;
      setLocalTracks('video', enabled);
      update({ cameraEnabled: enabled });
      shareMediaState();
    },

    leave() {
      if (state.phase !== 'in-call') return;
      channel?.send({ type: 'leave' });
      endCall('left');
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (state.phase === 'in-call') channel?.send({ type: 'leave' });
      releaseResources();
      listeners.clear();
    },
  };
}
