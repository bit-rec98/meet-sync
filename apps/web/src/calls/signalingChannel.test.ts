import { describe, expect, it } from 'vitest';
import { buildSignalingUrl, openSignalingChannel, type WebSocketLike } from './signalingChannel';

const PEER = '3f0e4b1c-6a52-4a67-9d5e-1f2a3b4c5d6e';

class FakeWebSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  closedWith: number | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

function connect() {
  let socket!: FakeWebSocket;
  const promise = openSignalingChannel(
    'ws://x/api/v1/ws?ticket=t',
    (url) => (socket = new FakeWebSocket(url)),
  );
  return { socket, promise };
}

describe('openSignalingChannel', () => {
  it('resolves when the socket opens, and sends messages as JSON text', async () => {
    const { socket, promise } = connect();
    socket.open();
    const channel = await promise;
    channel.send({ type: 'join', media: 'video' });
    expect(socket.sent).toEqual(['{"type":"join","media":"video"}']);
    expect(socket.url).toBe('ws://x/api/v1/ws?ticket=t');
  });

  it('rejects when the connection fails or closes before it opens', async () => {
    const failing = connect();
    failing.socket.onerror?.();
    await expect(failing.promise).rejects.toThrow(/Could not open/);

    const refused = connect();
    refused.socket.onclose?.({ code: 1006 });
    await expect(refused.promise).rejects.toThrow(/Could not open/);
  });

  it('delivers valid server messages and ignores everything else', async () => {
    const { socket, promise } = connect();
    socket.open();
    const channel = await promise;
    const received: unknown[] = [];
    channel.onMessage = (message) => received.push(message);

    socket.onmessage?.({ data: JSON.stringify({ type: 'peer-left', peerId: PEER }) });
    socket.onmessage?.({ data: 'not json' });
    socket.onmessage?.({ data: JSON.stringify({ type: 'nope' }) });
    socket.onmessage?.({ data: JSON.stringify({ type: 'peer-left', peerId: 'not-a-uuid' }) });
    socket.onmessage?.({ data: new ArrayBuffer(4) });

    expect(received).toEqual([{ type: 'peer-left', peerId: PEER }]);
  });

  it('reports how the connection ended', async () => {
    const { socket, promise } = connect();
    socket.open();
    const channel = await promise;
    const closes: number[] = [];
    channel.onClose = (event) => closes.push(event.code);
    socket.onclose?.({ code: 4001 });
    socket.onclose?.({ code: 0 }); // some browsers report no code for a dropped connection
    expect(closes).toEqual([4001, 1006]);
  });

  it('does not send on a socket that is not open, and closes normally on request', async () => {
    const { socket, promise } = connect();
    socket.open();
    const channel = await promise;
    socket.readyState = 3;
    channel.send({ type: 'leave' });
    expect(socket.sent).toEqual([]);
    channel.close();
    expect(socket.closedWith).toBe(1000);
  });
});

describe('buildSignalingUrl', () => {
  const page = { protocol: 'http:', host: 'localhost:5173' };

  it('derives the address from the page in development, so the dev proxy carries it', () => {
    expect(buildSignalingUrl({ ticket: 'abc', page })).toBe(
      'ws://localhost:5173/api/v1/ws?ticket=abc',
    );
    expect(
      buildSignalingUrl({ ticket: 'abc', page: { protocol: 'https:', host: 'app.example.com' } }),
    ).toBe('wss://app.example.com/api/v1/ws?ticket=abc');
  });

  it('uses the configured address when there is one (production: straight to the API host)', () => {
    expect(
      buildSignalingUrl({ ticket: 'abc', page, override: 'wss://api.example.com/api/v1/ws' }),
    ).toBe('wss://api.example.com/api/v1/ws?ticket=abc');
    expect(buildSignalingUrl({ ticket: 'abc', page, override: '   ' })).toContain(
      'ws://localhost:5173',
    );
  });

  it('encodes the ticket so it cannot change the address', () => {
    expect(buildSignalingUrl({ ticket: 'a&b=c#d', page })).toBe(
      'ws://localhost:5173/api/v1/ws?ticket=a%26b%3Dc%23d',
    );
  });

  it('refuses an address that is not a WebSocket address', () => {
    for (const override of [
      'https://api.example.com/ws',
      'javascript:alert(1)',
      'api.example.com/ws',
    ]) {
      expect(() => buildSignalingUrl({ ticket: 'abc', page, override }), override).toThrow();
    }
  });
});
