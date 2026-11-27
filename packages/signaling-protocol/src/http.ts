import { z } from 'zod';

/** Body of `POST /api/v1/ws-tickets`. */
export const wsTicketRequestSchema = z.strictObject({ meetingId: z.uuid() });
export type WsTicketRequest = z.infer<typeof wsTicketRequestSchema>;

/** Answer of `POST /api/v1/ws-tickets`: open the WebSocket with `?ticket=<ticket>` before it expires. */
export type WsTicketResponse = { ticket: string; expiresInSeconds: number };

/** One entry of an RTCPeerConnection's `iceServers`. TURN entries carry time-limited credentials. */
export type IceServer = { urls: string[]; username?: string; credential?: string };

/** Answer of `GET /api/v1/ice-servers`. */
export type IceServersResponse = { iceServers: IceServer[] };
