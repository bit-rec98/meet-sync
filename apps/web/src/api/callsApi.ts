import type { IceServer, WsTicketResponse } from '@meet-sync/signaling-protocol';
import type { ApiClient } from './client';
import { ApiError } from './errors';

const malformed = (): ApiError => new ApiError({ status: 200, code: 'unknown_error' });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseTicket(value: unknown): WsTicketResponse {
  if (
    isRecord(value) &&
    typeof value['ticket'] === 'string' &&
    value['ticket'] !== '' &&
    typeof value['expiresInSeconds'] === 'number'
  ) {
    return { ticket: value['ticket'], expiresInSeconds: value['expiresInSeconds'] };
  }
  throw malformed();
}

function parseIceServer(value: unknown): IceServer {
  if (!isRecord(value) || !Array.isArray(value['urls'])) throw malformed();
  const urls = value['urls'];
  if (!urls.every((url): url is string => typeof url === 'string')) throw malformed();
  const server: IceServer = { urls };
  if (value['username'] !== undefined) {
    if (typeof value['username'] !== 'string') throw malformed();
    server.username = value['username'];
  }
  if (value['credential'] !== undefined) {
    if (typeof value['credential'] !== 'string') throw malformed();
    server.credential = value['credential'];
  }
  return server;
}

export type CallsApi = ReturnType<typeof createCallsApi>;

export function createCallsApi(client: ApiClient) {
  return {
    /**
     * A single-use ticket to open the signaling WebSocket for a meeting. Fails when the user may not
     * join right now (`not_found` for strangers, `invalid_state` outside the join window).
     */
    async requestTicket(meetingId: string): Promise<WsTicketResponse> {
      return parseTicket(
        await client.request<unknown>('POST', '/ws-tickets', { body: { meetingId } }),
      );
    },

    /** The `iceServers` for new peer connections: STUN, and TURN with credentials made for the user. */
    async iceServers(): Promise<IceServer[]> {
      const answer = await client.request<unknown>('GET', '/ice-servers');
      if (!isRecord(answer) || !Array.isArray(answer['iceServers'])) throw malformed();
      return answer['iceServers'].map(parseIceServer);
    },
  };
}
