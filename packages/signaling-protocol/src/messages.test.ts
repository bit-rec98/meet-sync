import { describe, expect, it } from 'vitest';
import { MAX_CANDIDATE_LENGTH, MAX_SDP_LENGTH } from './limits.js';
import { parseClientMessage, parseServerMessage } from './messages.js';
import { wsTicketRequestSchema } from './http.js';

const PEER = '3f0e4b1c-6a52-4a67-9d5e-1f2a3b4c5d6e';
const OTHER = '8a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d';
const text = (value: unknown): string => JSON.stringify(value);

describe('client messages', () => {
  it('accepts every message of the protocol', () => {
    const valid = [
      { type: 'join', media: 'video' },
      { type: 'join', media: 'audio' },
      { type: 'leave' },
      { type: 'offer', to: PEER, sdp: 'v=0\r\n' },
      { type: 'answer', to: PEER, sdp: 'v=0\r\n' },
      {
        type: 'ice-candidate',
        to: PEER,
        candidate: {
          candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      },
      {
        type: 'ice-candidate',
        to: PEER,
        candidate: { candidate: '', sdpMid: null, sdpMLineIndex: null, usernameFragment: null },
      },
      { type: 'media-state', audioEnabled: true, videoEnabled: false },
    ];
    for (const message of valid) {
      expect(parseClientMessage(text(message)), text(message)).toEqual(message);
    }
  });

  it('rejects anything that is not JSON, not an object, or has no known type', () => {
    for (const raw of [
      '',
      'hello',
      '{',
      'null',
      '42',
      '[]',
      '"join"',
      text({}),
      text({ type: 'nope' }),
      text({ type: 1 }),
    ]) {
      expect(parseClientMessage(raw), raw).toBeNull();
    }
  });

  it('rejects a sender id: only the server decides who a message is from', () => {
    expect(
      parseClientMessage(text({ type: 'offer', to: PEER, sdp: 'v=0', from: OTHER })),
    ).toBeNull();
    expect(
      parseClientMessage(
        text({ type: 'ice-candidate', to: PEER, candidate: { candidate: 'x' }, from: OTHER }),
      ),
    ).toBeNull();
  });

  it('rejects unknown fields everywhere, including inside a candidate', () => {
    expect(parseClientMessage(text({ type: 'join', media: 'video', role: 'host' }))).toBeNull();
    expect(parseClientMessage(text({ type: 'leave', reason: 'bye' }))).toBeNull();
    expect(
      parseClientMessage(
        text({ type: 'ice-candidate', to: PEER, candidate: { candidate: 'x', extra: 1 } }),
      ),
    ).toBeNull();
  });

  it('rejects an unknown media type and wrong field types', () => {
    for (const message of [
      { type: 'join', media: 'screen' },
      { type: 'join' },
      { type: 'media-state', audioEnabled: 'yes', videoEnabled: true },
      { type: 'media-state', audioEnabled: true },
      { type: 'offer', to: 123, sdp: 'v=0' },
      { type: 'offer', to: PEER },
    ]) {
      expect(parseClientMessage(text(message)), text(message)).toBeNull();
    }
  });

  it('requires a peer id to be a UUID, so it cannot carry anything else', () => {
    for (const to of ['', 'everyone', '*', "' OR 1=1", '../x', `${PEER}x`]) {
      expect(parseClientMessage(text({ type: 'offer', to, sdp: 'v=0' })), to).toBeNull();
    }
  });

  it('limits the size of session descriptions and candidates', () => {
    expect(
      parseClientMessage(text({ type: 'offer', to: PEER, sdp: 'x'.repeat(MAX_SDP_LENGTH) })),
    ).not.toBeNull();
    expect(
      parseClientMessage(text({ type: 'offer', to: PEER, sdp: 'x'.repeat(MAX_SDP_LENGTH + 1) })),
    ).toBeNull();
    expect(parseClientMessage(text({ type: 'offer', to: PEER, sdp: '' }))).toBeNull();
    expect(
      parseClientMessage(
        text({
          type: 'ice-candidate',
          to: PEER,
          candidate: { candidate: 'x'.repeat(MAX_CANDIDATE_LENGTH + 1) },
        }),
      ),
    ).toBeNull();
  });

  it('rejects out-of-range candidate indexes', () => {
    for (const sdpMLineIndex of [-1, 65536, 1.5, '0']) {
      expect(
        parseClientMessage(
          text({ type: 'ice-candidate', to: PEER, candidate: { candidate: 'x', sdpMLineIndex } }),
        ),
        String(sdpMLineIndex),
      ).toBeNull();
    }
  });

  it('does not let prototype pollution keys through', () => {
    const polluted = '{"type":"join","media":"video","__proto__":{"admin":true}}';
    expect(parseClientMessage(polluted)).toBeNull();
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
  });
});

describe('server messages', () => {
  const peer = {
    id: PEER,
    displayName: 'Ana',
    media: 'video',
    audioEnabled: true,
    videoEnabled: true,
  };

  it('accepts every message the server sends', () => {
    const valid = [
      { type: 'joined', selfId: OTHER, peers: [peer] },
      { type: 'joined', selfId: OTHER, peers: [] },
      { type: 'peer-joined', peer },
      { type: 'peer-left', peerId: PEER },
      { type: 'peer-media-state', peerId: PEER, audioEnabled: false, videoEnabled: true },
      { type: 'offer', from: PEER, sdp: 'v=0' },
      { type: 'answer', from: PEER, sdp: 'v=0' },
      { type: 'ice-candidate', from: PEER, candidate: { candidate: 'x' } },
      { type: 'bye', reason: 'replaced' },
      { type: 'error', code: 'room_full' },
      { type: 'error', code: 'server_error' },
    ];
    for (const message of valid) {
      expect(parseServerMessage(text(message)), text(message)).toEqual(message);
    }
  });

  it('rejects messages that do not follow the protocol, so a client never acts on garbage', () => {
    for (const message of [
      { type: 'joined', selfId: OTHER },
      { type: 'peer-joined', peer: { ...peer, email: 'ana@example.test' } },
      { type: 'bye', reason: 'because' },
      { type: 'error', code: 'something_else' },
      { type: 'offer', sdp: 'v=0' },
    ]) {
      expect(parseServerMessage(text(message)), text(message)).toBeNull();
    }
    expect(parseServerMessage('not json')).toBeNull();
  });
});

describe('ticket request', () => {
  it('needs exactly a meeting id that is a UUID', () => {
    expect(wsTicketRequestSchema.safeParse({ meetingId: PEER }).success).toBe(true);
    for (const body of [{}, { meetingId: 'x' }, { meetingId: PEER, userId: OTHER }, null, 'text']) {
      expect(wsTicketRequestSchema.safeParse(body).success, text(body)).toBe(false);
    }
  });
});
