import {
  wsTicketRequestSchema,
  type IceServersResponse,
  type WsTicketResponse,
} from '@meet-sync/signaling-protocol';
import { Router } from 'express';
import type { SignalingConfig } from '../../config/env.js';
import type { AuthService } from '../../services/authService.js';
import type { MeetingService } from '../../services/meetingService.js';
import { buildIceServers } from '../../signaling/iceServers.js';
import type { TicketStore } from '../../signaling/tickets.js';
import { noStore } from '../middleware/noStore.js';
import type { RateLimiters } from '../middleware/rateLimits.js';
import { getAuthenticatedUserId, requireAuth } from '../middleware/requireAuth.js';
import { requireJsonContentType } from '../middleware/requireJsonContentType.js';
import { parseBody } from '../validation.js';

export type SignalingRouterDependencies = {
  auth: AuthService;
  meetings: MeetingService;
  tickets: TicketStore;
  config: SignalingConfig;
  limiters: RateLimiters;
  now: () => Date;
};

/**
 * What a browser needs before it can join a call: a ticket to open the WebSocket, and the ICE
 * servers for its peer connections. Authentication is applied per route, so this router can be
 * mounted next to others without answering for paths that are not its own.
 */
export function createSignalingRouter({
  auth,
  meetings,
  tickets,
  config,
  limiters,
  now,
}: SignalingRouterDependencies): Router {
  const router = Router();

  router.post(
    '/ws-tickets',
    requireAuth(auth),
    limiters.signaling,
    noStore,
    requireJsonContentType,
    async (req, res) => {
      const { meetingId } = parseBody(wsTicketRequestSchema, req.body);
      const userId = getAuthenticatedUserId(res);
      // The same rule as joining: host or invitee, scheduled, within the join window. A stranger
      // gets the same "not found" as for a meeting that does not exist.
      await meetings.assertCanJoin(userId, meetingId);
      const user = await auth.getUser(userId);
      const issued = tickets.issue({ userId, displayName: user.displayName, meetingId });
      const body: WsTicketResponse = {
        ticket: issued.ticket,
        expiresInSeconds: issued.expiresInSeconds,
      };
      res.status(201).json(body);
    },
  );

  router.get('/ice-servers', requireAuth(auth), limiters.signaling, noStore, (_req, res) => {
    const body: IceServersResponse = {
      iceServers: buildIceServers(config, getAuthenticatedUserId(res), now()),
    };
    res.json(body);
  });

  return router;
}
