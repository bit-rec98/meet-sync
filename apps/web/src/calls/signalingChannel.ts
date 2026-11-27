import { SIGNALING_PATH, parseServerMessage } from '@meet-sync/signaling-protocol';
import type { SignalingChannel } from './types';

/** The part of the browser's WebSocket that is used; tests provide a fake. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const OPEN = 1;
const ABNORMAL_CLOSE = 1006;

/**
 * Opens the signaling WebSocket and resolves once it is open. Only valid server messages are passed
 * on: anything else (binary data, text that does not follow the protocol) is ignored.
 */
export function openSignalingChannel(
  url: string,
  createWebSocket: WebSocketFactory,
): Promise<SignalingChannel> {
  return new Promise((resolve, reject) => {
    const socket = createWebSocket(url);

    const channel: SignalingChannel = {
      onMessage: null,
      onClose: null,
      send(message) {
        if (socket.readyState === OPEN) socket.send(JSON.stringify(message));
      },
      close() {
        socket.close(1000);
      },
    };

    socket.onopen = () => resolve(channel);
    // Before it opens, a close or an error means the connection could not be made (for example the
    // ticket was refused, which the browser reports without details).
    socket.onerror = () => reject(new Error('Could not open the signaling connection'));
    socket.onclose = (event) => {
      reject(new Error('Could not open the signaling connection'));
      channel.onClose?.({ code: event.code || ABNORMAL_CLOSE });
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = parseServerMessage(event.data);
      if (message) channel.onMessage?.(message);
    };
  });
}

export type SignalingAddress = {
  ticket: string;
  /** `VITE_SIGNALING_URL`: the WebSocket address on the API host, needed in production. */
  override?: string | undefined;
  page: { protocol: string; host: string };
};

/**
 * The address to open. In development the WebSocket goes through the same dev proxy as REST, so it is
 * derived from the page. In production the browser connects straight to the API host, because Netlify
 * cannot proxy WebSockets, and `VITE_SIGNALING_URL` says where.
 */
export function buildSignalingUrl({ ticket, override, page }: SignalingAddress): string {
  const base =
    override && override.trim() !== ''
      ? override.trim()
      : `${page.protocol === 'https:' ? 'wss:' : 'ws:'}//${page.host}${SIGNALING_PATH}`;
  if (!/^wss?:\/\//.test(base))
    throw new Error('The signaling address must start with ws:// or wss://');
  return `${base}?ticket=${encodeURIComponent(ticket)}`;
}
