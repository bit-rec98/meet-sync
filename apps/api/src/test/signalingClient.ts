import {
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@meet-sync/signaling-protocol';
import { WebSocket } from 'ws';

const POLL_MS = 10;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A WebSocket client for tests that keeps everything it receives and how the connection ended. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  /** Anything the server sent that does not follow the protocol. A test fails if this is not empty. */
  readonly invalid: string[] = [];
  closeEvent: { code: number; reason: string } | null = null;
  private readonly used = new Set<number>();

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const text = data.toString();
      const message = parseServerMessage(text);
      if (message) this.messages.push(message);
      else this.invalid.push(text);
    });
    ws.on('close', (code, reason) => {
      this.closeEvent = { code, reason: reason.toString() };
    });
    ws.on('error', () => undefined);
  }

  /** Opens a connection. Resolves with the client, or with the HTTP status if the upgrade was refused. */
  static attempt(
    url: string,
    options: { origin?: string; autoPong?: boolean } = {},
  ): Promise<{ client: TestClient } | { status: number }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        ...(options.origin === undefined ? {} : { headers: { Origin: options.origin } }),
        ...(options.autoPong === undefined ? {} : { autoPong: options.autoPong }),
      });
      const client = new TestClient(ws);
      ws.once('open', () => resolve({ client }));
      ws.once('unexpected-response', (_request, response) => {
        resolve({ status: response.statusCode ?? 0 });
        response.resume();
      });
      ws.once('error', (error) => {
        // An upgrade the server refuses is reported by 'unexpected-response'; anything else is a failure.
        if (!/Unexpected server response/.test(error.message)) reject(error);
      });
    });
  }

  static async connect(
    url: string,
    options: { origin?: string; autoPong?: boolean } = {},
  ): Promise<TestClient> {
    const result = await TestClient.attempt(url, options);
    if ('status' in result)
      throw new Error(`The server refused the connection with ${result.status}`);
    return result.client;
  }

  send(message: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(message));
  }

  sendRaw(data: string | Buffer, binary = false): void {
    this.ws.send(data, { binary });
  }

  /** Waits for the next message of this type that has not been taken yet, and takes it. */
  async next<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const index = this.messages.findIndex(
        (message, position) => message.type === type && !this.used.has(position),
      );
      if (index >= 0) {
        this.used.add(index);
        return this.messages[index] as Extract<ServerMessage, { type: T }>;
      }
      await sleep(POLL_MS);
    }
    throw new Error(
      `No "${type}" message arrived. Received: ${JSON.stringify(this.messages.map((m) => m.type))}`,
    );
  }

  /** Messages received and not yet taken, after letting any in-flight ones arrive. */
  async untaken(waitMs = 100): Promise<ServerMessage[]> {
    await sleep(waitMs);
    return this.messages.filter((_, position) => !this.used.has(position));
  }

  /** Waits for the connection to end and returns how. */
  async closed(timeoutMs = 2000): Promise<{ code: number; reason: string }> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (this.closeEvent) return this.closeEvent;
      await sleep(POLL_MS);
    }
    throw new Error('The connection did not close');
  }

  get isClosed(): boolean {
    return this.closeEvent !== null;
  }

  terminate(): void {
    this.ws.terminate();
  }
}
