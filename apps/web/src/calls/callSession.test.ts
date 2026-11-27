import type { IceServer, Media } from '@meet-sync/signaling-protocol';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import {
  FakeStream,
  PEER_A,
  PEER_B,
  PEER_C,
  SELF,
  createFakeEnvironment,
  peer,
} from '../test/callFakes';
import { createCallSession } from './callSession';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const environment = createFakeEnvironment();
  const api = {
    requestTicket: vi.fn(async (_meetingId: string) => ({ ticket: 'ticket-1' })),
    iceServers: vi.fn(async (): Promise<IceServer[]> => [{ urls: ['stun:stun.example:3478'] }]),
  };
  const session = createCallSession({ environment, api, meetingId: 'meeting-1' });
  return { environment, api, session };
}

/** Starts the call and lets the server admit the user, with `others` already in the room. */
async function joined(media: Media = 'video', others: ReturnType<typeof peer>[] = []) {
  const context = setup();
  await context.session.start(media);
  context.environment.channel.emit({ type: 'joined', selfId: SELF, peers: others });
  await flush();
  return context;
}

const failure = (name: string) => Object.assign(new Error(name), { name });

describe('starting', () => {
  it('gets media, a ticket and ICE servers, opens signaling, and sends join', async () => {
    const { environment, api, session } = setup();
    await session.start('video');

    expect(environment.mediaRequests[0]?.video).toBeTruthy();
    expect(api.requestTicket).toHaveBeenCalledWith('meeting-1');
    expect(environment.tickets).toEqual(['ticket-1']);
    expect(environment.channel.sent).toEqual([{ type: 'join', media: 'video' }]);
    expect(session.getState()).toMatchObject({ phase: 'starting', media: 'video' });
  });

  it('asks for no camera in an audio call', async () => {
    const { environment, session } = setup();
    await session.start('audio');
    expect(environment.mediaRequests[0]?.video).toBe(false);
    expect(environment.channel.sent).toEqual([{ type: 'join', media: 'audio' }]);
  });

  it('is in the call once the server says so, with the camera on only for video', async () => {
    const video = await joined('video');
    expect(video.session.getState()).toMatchObject({
      phase: 'in-call',
      hasCamera: true,
      cameraEnabled: true,
      microphoneEnabled: true,
    });
    expect(video.session.getState().localStream).toBe(video.environment.streams[0]);

    const audio = await joined('audio');
    expect(audio.session.getState()).toMatchObject({
      phase: 'in-call',
      hasCamera: false,
      cameraEnabled: false,
    });
  });

  it('ignores a second start while one is running', async () => {
    const { environment, session } = setup();
    await session.start('video');
    await session.start('video');
    expect(environment.mediaRequests).toHaveLength(1);
    environment.channel.emit({ type: 'joined', selfId: SELF, peers: [] });
    await session.start('audio');
    expect(environment.mediaRequests).toHaveLength(1);
  });

  it('lists the ICE servers it was given on every peer connection', async () => {
    const { environment } = await joined('video', [peer(PEER_A, 'Ana')]);
    expect(environment.connections[0]?.configuration.iceServers).toEqual([
      { urls: ['stun:stun.example:3478'] },
    ]);
  });
});

describe('when starting fails', () => {
  const cases: [string, (c: ReturnType<typeof setup>) => void, string][] = [
    [
      'the user refuses camera access',
      (c) => c.environment.failMedia(failure('NotAllowedError')),
      'permission_denied',
    ],
    ['there is no camera', (c) => c.environment.failMedia(failure('NotFoundError')), 'no_device'],
    [
      'the camera is in use',
      (c) => c.environment.failMedia(failure('NotReadableError')),
      'media_failed',
    ],
    [
      'the meeting is not open for joining',
      (c) =>
        c.api.requestTicket.mockRejectedValue(new ApiError({ status: 409, code: 'invalid_state' })),
      'not_available',
    ],
    [
      'the user has no access',
      (c) =>
        c.api.requestTicket.mockRejectedValue(new ApiError({ status: 404, code: 'not_found' })),
      'not_available',
    ],
    [
      'too many tickets were requested',
      (c) =>
        c.api.requestTicket.mockRejectedValue(new ApiError({ status: 429, code: 'rate_limited' })),
      'rate_limited',
    ],
    [
      'the network is down',
      (c) =>
        c.api.requestTicket.mockRejectedValue(new ApiError({ status: 0, code: 'network_error' })),
      'network',
    ],
    [
      'the ICE servers cannot be fetched',
      (c) =>
        c.api.iceServers.mockRejectedValue(new ApiError({ status: 500, code: 'internal_error' })),
      'unexpected',
    ],
    ['the signaling connection cannot be opened', (c) => c.environment.failSignaling(), 'network'],
  ];

  it.each(cases)(
    'returns to the lobby with the reason when %s, and releases the camera',
    async (_name, arrange, reason) => {
      const context = setup();
      arrange(context);
      await context.session.start('video');

      expect(context.session.getState()).toMatchObject({
        phase: 'lobby',
        startFailure: reason,
        localStream: null,
        media: null,
      });
      for (const stream of context.environment.streams) {
        expect(stream.tracks.every((track) => track.stopped)).toBe(true);
      }
      expect(context.environment.channel.sent).toEqual([]);
    },
  );

  it('can be tried again after a failure', async () => {
    const context = setup();
    context.environment.failMedia(failure('NotAllowedError'));
    await context.session.start('video');
    expect(context.session.getState().startFailure).toBe('permission_denied');

    await context.session.start('video');
    context.environment.channel.emit({ type: 'joined', selfId: SELF, peers: [] });
    expect(context.session.getState()).toMatchObject({ phase: 'in-call', startFailure: null });
  });

  it('returns to the lobby, not to an ended call, if the connection drops before joining', async () => {
    const { environment, session } = setup();
    await session.start('video');
    environment.channel.emitClose(1006);
    expect(session.getState()).toMatchObject({ phase: 'lobby', startFailure: 'network' });
    expect(environment.streams[0]?.tracks.every((track) => track.stopped)).toBe(true);
  });
});

describe('connecting to the people already in the call', () => {
  it('sends an offer to each of them, with our tracks attached', async () => {
    const { environment } = await joined('video', [peer(PEER_A, 'Ana'), peer(PEER_B, 'Ben')]);

    expect(environment.connections).toHaveLength(2);
    expect(environment.channel.sentOfType('offer')).toEqual([
      { type: 'offer', to: PEER_A, sdp: 'offer-from-connection-0' },
      { type: 'offer', to: PEER_B, sdp: 'offer-from-connection-1' },
    ]);
    for (const connection of environment.connections) {
      expect(connection.localDescription?.type).toBe('offer');
      expect(connection.addedTracks).toHaveLength(2); // microphone and camera
    }
  });

  it('shows them in the state while connecting', async () => {
    const { session } = await joined('video', [peer(PEER_A, 'Ana')]);
    expect(session.getState().peers).toEqual([
      {
        id: PEER_A,
        displayName: 'Ana',
        media: 'video',
        audioEnabled: true,
        videoEnabled: true,
        stream: null,
        connection: 'connecting',
      },
    ]);
  });

  it('completes the connection when the answer arrives', async () => {
    const { environment } = await joined('video', [peer(PEER_A, 'Ana')]);
    environment.channel.emit({ type: 'answer', from: PEER_A, sdp: 'their-answer' });
    await flush();
    expect(environment.connections[0]?.remoteDescription).toEqual({
      type: 'answer',
      sdp: 'their-answer',
    });
  });

  it('keeps the call going when an offer cannot be made, and marks that person as failed', async () => {
    const context = setup();
    await context.session.start('video');
    const original = context.environment.createPeerConnection.bind(context.environment);
    context.environment.createPeerConnection = (configuration) => {
      const connection = original(configuration);
      (connection as unknown as { failOffer: boolean }).failOffer = true;
      return connection;
    };
    context.environment.channel.emit({
      type: 'joined',
      selfId: SELF,
      peers: [peer(PEER_A, 'Ana')],
    });
    await flush();
    expect(context.session.getState().phase).toBe('in-call');
    expect(context.session.getState().peers[0]?.connection).toBe('failed');
  });
});

describe('people who join later', () => {
  it('only get a connection ready and wait for their offer, announcing the arrival', async () => {
    const { environment, session } = await joined('video');
    environment.channel.emit({ type: 'peer-joined', peer: peer(PEER_A, 'Ana') });

    await flush(); // an offer, if one were wrongly made, is sent asynchronously
    expect(environment.connections).toHaveLength(1);
    expect(environment.channel.sentOfType('offer')).toEqual([]);
    expect(session.getState().lastRoomEvent).toEqual({ id: 1, kind: 'joined', name: 'Ana' });
  });

  it('are answered when their offer arrives', async () => {
    const { environment } = await joined('video');
    environment.channel.emit({ type: 'peer-joined', peer: peer(PEER_A, 'Ana') });
    environment.channel.emit({ type: 'offer', from: PEER_A, sdp: 'their-offer' });
    await flush();

    const connection = environment.connections[0]!;
    expect(connection.remoteDescription).toEqual({ type: 'offer', sdp: 'their-offer' });
    expect(connection.localDescription?.type).toBe('answer');
    expect(environment.channel.sentOfType('answer')).toEqual([
      { type: 'answer', to: PEER_A, sdp: 'answer-from-connection-0' },
    ]);
  });

  it('replace an existing entry instead of leaving a stray connection', async () => {
    const { environment, session } = await joined('video');
    environment.channel.emit({ type: 'peer-joined', peer: peer(PEER_A, 'Ana') });
    environment.channel.emit({ type: 'peer-joined', peer: peer(PEER_A, 'Ana') });
    expect(environment.connections[0]?.closed).toBe(true);
    expect(session.getState().peers).toHaveLength(1);
  });
});

describe('network candidates', () => {
  it('are sent to the right peer in the protocol’s shape, and the end of candidates sends nothing', async () => {
    const { environment } = await joined('video', [peer(PEER_A, 'Ana')]);
    const connection = environment.connections[0]!;
    connection.emitLocalCandidate({
      candidate: 'candidate:1 1 udp 1 192.0.2.1 5 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'abcd',
    });
    connection.emitLocalCandidate({ candidate: 'candidate:2' });
    connection.emitLocalCandidate(null);

    expect(environment.channel.sentOfType('ice-candidate')).toEqual([
      {
        type: 'ice-candidate',
        to: PEER_A,
        candidate: {
          candidate: 'candidate:1 1 udp 1 192.0.2.1 5 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: 'abcd',
        },
      },
      { type: 'ice-candidate', to: PEER_A, candidate: { candidate: 'candidate:2' } },
    ]);
  });

  it('that arrive before the remote description wait for it instead of failing', async () => {
    const { environment } = await joined('video');
    environment.channel.emit({ type: 'peer-joined', peer: peer(PEER_A, 'Ana') });
    const connection = environment.connections[0]!;

    environment.channel.emit({
      type: 'ice-candidate',
      from: PEER_A,
      candidate: { candidate: 'early-1' },
    });
    environment.channel.emit({
      type: 'ice-candidate',
      from: PEER_A,
      candidate: { candidate: 'early-2' },
    });
    expect(connection.addedCandidates).toEqual([]);

    environment.channel.emit({ type: 'offer', from: PEER_A, sdp: 'their-offer' });
    await flush();
    expect(connection.addedCandidates.map((c) => c.candidate)).toEqual(['early-1', 'early-2']);

    environment.channel.emit({
      type: 'ice-candidate',
      from: PEER_A,
      candidate: { candidate: 'late' },
    });
    await flush();
    expect(connection.addedCandidates.map((c) => c.candidate)).toEqual([
      'early-1',
      'early-2',
      'late',
    ]);
  });

  it('that arrive before the answer are queued for connections we started', async () => {
    const { environment } = await joined('video', [peer(PEER_A, 'Ana')]);
    environment.channel.emit({
      type: 'ice-candidate',
      from: PEER_A,
      candidate: { candidate: 'early' },
    });
    expect(environment.connections[0]?.addedCandidates).toEqual([]);
    environment.channel.emit({ type: 'answer', from: PEER_A, sdp: 'a' });
    await flush();
    expect(environment.connections[0]?.addedCandidates.map((c) => c.candidate)).toEqual(['early']);
  });

  it('from people who are not in the call are ignored, as are their offers and answers', async () => {
    const { environment, session } = await joined('video');
    environment.channel.emit({
      type: 'ice-candidate',
      from: PEER_C,
      candidate: { candidate: 'x' },
    });
    environment.channel.emit({ type: 'offer', from: PEER_C, sdp: 'x' });
    environment.channel.emit({ type: 'answer', from: PEER_C, sdp: 'x' });
    await flush();
    expect(environment.connections).toHaveLength(0);
    expect(session.getState().phase).toBe('in-call');
  });
});

describe('what the other people send', () => {
  it('appears in their entry when their stream arrives', async () => {
    const { environment, session } = await joined('video', [peer(PEER_A, 'Ana')]);
    const remote = new FakeStream();
    environment.connections[0]?.emitRemoteStream(remote);
    expect(session.getState().peers[0]?.stream).toBe(remote);
  });

  it('follows the connection’s state', async () => {
    const { environment, session } = await joined('video', [peer(PEER_A, 'Ana')]);
    const connection = environment.connections[0]!;
    const status = () => session.getState().peers[0]?.connection;
    connection.setConnectionState('connecting');
    expect(status()).toBe('connecting');
    connection.setConnectionState('connected');
    expect(status()).toBe('connected');
    connection.setConnectionState('disconnected');
    expect(status()).toBe('connecting'); // it may recover
    connection.setConnectionState('failed');
    expect(status()).toBe('failed');
  });

  it('shows muting and camera changes', async () => {
    const { environment, session } = await joined('video', [peer(PEER_A, 'Ana')]);
    environment.channel.emit({
      type: 'peer-media-state',
      peerId: PEER_A,
      audioEnabled: false,
      videoEnabled: false,
    });
    expect(session.getState().peers[0]).toMatchObject({ audioEnabled: false, videoEnabled: false });
    environment.channel.emit({
      type: 'peer-media-state',
      peerId: PEER_C,
      audioEnabled: false,
      videoEnabled: false,
    }); // unknown: ignored
    expect(session.getState().peers).toHaveLength(1);
  });

  it('is removed when the person leaves, closing the connection and announcing it', async () => {
    const { environment, session } = await joined('video', [
      peer(PEER_A, 'Ana'),
      peer(PEER_B, 'Ben'),
    ]);
    environment.channel.emit({ type: 'peer-left', peerId: PEER_A });

    expect(environment.connections[0]?.closed).toBe(true);
    expect(environment.connections[1]?.closed).toBe(false);
    expect(session.getState().peers.map((p) => p.id)).toEqual([PEER_B]);
    expect(session.getState().lastRoomEvent).toEqual({ id: 1, kind: 'left', name: 'Ana' });

    environment.channel.emit({ type: 'peer-left', peerId: PEER_C }); // unknown: nothing happens
    expect(session.getState().lastRoomEvent?.id).toBe(1);
  });

  it('numbers room events, so each can be announced', async () => {
    const { environment, session } = await joined('video');
    environment.channel.emit({ type: 'peer-joined', peer: peer(PEER_A, 'Ana') });
    environment.channel.emit({ type: 'peer-left', peerId: PEER_A });
    environment.channel.emit({ type: 'peer-joined', peer: peer(PEER_A, 'Ana') });
    expect(session.getState().lastRoomEvent).toEqual({ id: 3, kind: 'joined', name: 'Ana' });
  });
});

describe('video quality in a bigger room', () => {
  const videoBitrates = (connection: {
    senders: { track: { kind: string }; parameters: { encodings?: { maxBitrate?: number }[] } }[];
  }) =>
    connection.senders
      .filter((s) => s.track.kind === 'video')
      .map((s) => s.parameters.encodings?.[0]?.maxBitrate);

  it('shares the upload budget between the connections, and raises it again when people leave', async () => {
    const { environment } = await joined('video', [
      peer(PEER_A, 'Ana'),
      peer(PEER_B, 'Ben'),
      peer(PEER_C, 'Cleo'),
    ]);
    for (const peerId of [PEER_A, PEER_B, PEER_C])
      environment.channel.emit({ type: 'answer', from: peerId, sdp: 'a' });
    await flush();
    for (const connection of environment.connections)
      expect(videoBitrates(connection)).toEqual([400_000]);

    environment.channel.emit({ type: 'peer-left', peerId: PEER_C });
    await flush();
    expect(videoBitrates(environment.connections[0]!)).toEqual([600_000]);
  });

  it('applies nothing to audio, and nothing at all in an audio call', async () => {
    const { environment } = await joined('audio', [peer(PEER_A, 'Ana', 'audio')]);
    environment.channel.emit({ type: 'answer', from: PEER_A, sdp: 'a' });
    await flush();
    expect(
      environment.connections[0]?.senders.every((sender) => sender.setCalls.length === 0),
    ).toBe(true);
  });
});

describe('microphone and camera', () => {
  it('muting switches the microphone off and tells the others', async () => {
    const { environment, session } = await joined('video');
    session.toggleMicrophone();
    expect(environment.streams[0]?.getAudioTracks()[0]?.enabled).toBe(false);
    expect(session.getState().microphoneEnabled).toBe(false);
    expect(environment.channel.sentOfType('media-state').at(-1)).toEqual({
      type: 'media-state',
      audioEnabled: false,
      videoEnabled: true,
    });

    session.toggleMicrophone();
    expect(environment.streams[0]?.getAudioTracks()[0]?.enabled).toBe(true);
    expect(environment.channel.sentOfType('media-state').at(-1)).toEqual({
      type: 'media-state',
      audioEnabled: true,
      videoEnabled: true,
    });
  });

  it('turning the camera off switches the video off and tells the others', async () => {
    const { environment, session } = await joined('video');
    session.toggleCamera();
    expect(environment.streams[0]?.getVideoTracks()[0]?.enabled).toBe(false);
    expect(session.getState().cameraEnabled).toBe(false);
    expect(environment.channel.sentOfType('media-state').at(-1)).toEqual({
      type: 'media-state',
      audioEnabled: true,
      videoEnabled: false,
    });
  });

  it('has no camera to switch in an audio call', async () => {
    const { environment, session } = await joined('audio');
    session.toggleCamera();
    expect(session.getState().cameraEnabled).toBe(false);
    expect(environment.channel.sentOfType('media-state')).toEqual([]);
    session.toggleMicrophone();
    expect(environment.channel.sentOfType('media-state').at(-1)).toEqual({
      type: 'media-state',
      audioEnabled: false,
      videoEnabled: false,
    });
  });

  it('does nothing before the call has started or after it ended', async () => {
    const before = setup();
    before.session.toggleMicrophone();
    before.session.toggleCamera();
    expect(before.environment.channel.sent).toEqual([]);

    const { environment, session } = await joined('video');
    session.leave();
    environment.channel.sent.length = 0;
    session.toggleMicrophone();
    expect(environment.channel.sent).toEqual([]);
  });
});

describe('leaving and ending', () => {
  it('leave says goodbye, releases everything, and ends the call as "left"', async () => {
    const { environment, session } = await joined('video', [peer(PEER_A, 'Ana')]);
    session.leave();

    expect(environment.channel.sentOfType('leave')).toEqual([{ type: 'leave' }]);
    expect(environment.channel.closed).toBe(true);
    expect(environment.connections[0]?.closed).toBe(true);
    expect(environment.streams[0]?.tracks.every((track) => track.stopped)).toBe(true);
    expect(session.getState()).toMatchObject({
      phase: 'ended',
      endReason: 'left',
      peers: [],
      localStream: null,
    });
  });

  it.each([
    ['replaced', 'replaced'],
    ['removed', 'removed'],
    ['meeting_cancelled', 'meeting_cancelled'],
    ['server_shutdown', 'server_shutdown'],
  ] as const)(
    'ends the call with the reason when the server says bye (%s)',
    async (reason, expected) => {
      const { environment, session } = await joined('video', [peer(PEER_A, 'Ana')]);
      environment.channel.emit({ type: 'bye', reason });
      expect(session.getState()).toMatchObject({ phase: 'ended', endReason: expected });
      expect(environment.streams[0]?.tracks.every((track) => track.stopped)).toBe(true);
      expect(environment.connections[0]?.closed).toBe(true);
    },
  );

  it.each([
    [4001, 'replaced'],
    [4002, 'removed'],
    [4003, 'meeting_cancelled'],
    [4004, 'not_allowed'],
    [4005, 'room_full'],
    [1001, 'server_shutdown'],
    [1006, 'connection_lost'],
    [1011, 'connection_lost'],
  ] as const)('explains a connection that closes with code %i as "%s"', async (code, expected) => {
    const { environment, session } = await joined('video');
    environment.channel.emitClose(code);
    expect(session.getState()).toMatchObject({ phase: 'ended', endReason: expected });
  });

  it('keeps the first reason when the server sends a message and then closes', async () => {
    const { environment, session } = await joined('video');
    environment.channel.emit({ type: 'bye', reason: 'removed' });
    environment.channel.emitClose(4002);
    environment.channel.emitClose(1006);
    expect(session.getState().endReason).toBe('removed');
  });

  it('ends with the right reason when the server refuses the join', async () => {
    for (const code of ['not_allowed', 'room_full'] as const) {
      const { environment, session } = setup();
      await session.start('video');
      environment.channel.emit({ type: 'error', code });
      expect(session.getState(), code).toMatchObject({ phase: 'ended', endReason: code });
    }
  });

  it('treats server errors as a lost connection, but ignores harmless ones', async () => {
    const lost = await joined('video');
    lost.environment.channel.emit({ type: 'error', code: 'server_error' });
    expect(lost.session.getState().endReason).toBe('connection_lost');

    const harmless = await joined('video', [peer(PEER_A, 'Ana')]);
    for (const code of ['unknown_peer', 'not_joined', 'already_joined'] as const) {
      harmless.environment.channel.emit({ type: 'error', code });
    }
    expect(harmless.session.getState().phase).toBe('in-call');
  });

  it('goes back to the lobby if the server rejects the chosen media', async () => {
    const { environment, session } = setup();
    await session.start('video');
    environment.channel.emit({ type: 'error', code: 'invalid_media' });
    expect(session.getState()).toMatchObject({ phase: 'lobby', startFailure: 'unexpected' });
  });
});

describe('dispose (the screen goes away)', () => {
  it('says goodbye if in a call, and releases everything', async () => {
    const { environment, session } = await joined('video', [peer(PEER_A, 'Ana')]);
    session.dispose();
    expect(environment.channel.sentOfType('leave')).toHaveLength(1);
    expect(environment.channel.closed).toBe(true);
    expect(environment.connections[0]?.closed).toBe(true);
    expect(environment.streams[0]?.tracks.every((track) => track.stopped)).toBe(true);
  });

  it('can be repeated, and ignores everything that comes afterwards', async () => {
    const { environment, session } = await joined('video');
    session.dispose();
    session.dispose();
    environment.channel.emit({ type: 'peer-joined', peer: peer(PEER_A, 'Ana') });
    environment.channel.emitClose(1006);
    await session.start('video');
    expect(environment.connections).toHaveLength(0);
    expect(environment.mediaRequests).toHaveLength(1);
    expect(environment.channel.sentOfType('leave')).toHaveLength(1);
  });

  it('does not send leave when it never joined', async () => {
    const { environment, session } = setup();
    session.dispose();
    expect(environment.channel.sent).toEqual([]);
  });

  it('releases the camera if the screen goes away while permission is being asked', async () => {
    const context = setup();
    let finish: (stream: FakeStream) => void = () => {};
    const stream = new FakeStream();
    context.environment.getUserMedia = () =>
      new Promise((resolve) => (finish = resolve as (s: FakeStream) => void));
    const starting = context.session.start('video');
    context.session.dispose();
    finish(stream);
    await starting;
    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
    expect(context.api.requestTicket).not.toHaveBeenCalled();
    expect(context.environment.tickets).toEqual([]);
  });

  it('closes the connection if the screen goes away while the ticket is being fetched', async () => {
    const context = setup();
    let release: () => void = () => {};
    context.api.requestTicket.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ ticket: 'late' }))),
    );
    const starting = context.session.start('video');
    await flush();
    context.session.dispose();
    release();
    await starting;
    expect(context.environment.streams[0]?.tracks.every((track) => track.stopped)).toBe(true);
    expect(context.environment.tickets).toEqual([]);
  });
});

describe('state snapshots', () => {
  it('notify subscribers on every change, and stop after unsubscribing', async () => {
    const { session } = setup();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    await session.start('video');
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    session.dispose();
    expect(listener).not.toHaveBeenCalled();
  });

  it('are immutable: a new object for every change, the same object between changes', async () => {
    const { environment, session } = await joined('video');
    const first = session.getState();
    expect(session.getState()).toBe(first);
    environment.channel.emit({ type: 'peer-joined', peer: peer(PEER_A, 'Ana') });
    expect(session.getState()).not.toBe(first);
    expect(first.peers).toEqual([]); // the old snapshot did not change
  });
});
