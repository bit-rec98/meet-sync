import { Router } from 'express';
import type { MeetingEvents } from '../../meetingEvents.js';
import type { AuthService } from '../../services/authService.js';
import type { MeetingService } from '../../services/meetingService.js';
import { toInviteeDto, toMeetingDto, toMeetingSummaryDto } from '../meetingDtos.js';
import { noStore } from '../middleware/noStore.js';
import type { RateLimiters } from '../middleware/rateLimits.js';
import { getAuthenticatedUserId, requireAuth } from '../middleware/requireAuth.js';
import { requireJsonContentType } from '../middleware/requireJsonContentType.js';
import {
  addInviteeBodySchema,
  createMeetingBodySchema,
  inviteeParamsSchema,
  listMeetingsQuerySchema,
  meetingParamsSchema,
  updateMeetingBodySchema,
} from '../schemas/meetings.js';
import { parseBody, parseParams, parseQuery } from '../validation.js';

export type MeetingRouterDependencies = {
  auth: AuthService;
  meetings: MeetingService;
  limiters: RateLimiters;
  /** Told about changes that must also reach people who are in a call. */
  events: MeetingEvents;
};

/**
 * Handlers only translate HTTP to service calls: authentication first, then input validation,
 * then the service, which decides who may do what.
 */
export function createMeetingRouter({
  auth,
  meetings,
  limiters,
  events,
}: MeetingRouterDependencies): Router {
  const router = Router();
  router.use(requireAuth(auth)); // every meeting route needs a logged-in user
  router.use(noStore); // responses contain personal data

  router.post('/', requireJsonContentType, async (req, res) => {
    const body = parseBody(createMeetingBodySchema, req.body);
    const meeting = await meetings.create(getAuthenticatedUserId(res), body);
    res.status(201).json(toMeetingDto(meeting));
  });

  router.get('/', async (req, res) => {
    const query = parseQuery(listMeetingsQuerySchema, req.query);
    const { items, total } = await meetings.list(getAuthenticatedUserId(res), query);
    res.json({
      items: items.map(toMeetingSummaryDto),
      limit: query.limit,
      offset: query.offset,
      total,
    });
  });

  router.get('/:id', async (req, res) => {
    const { id } = parseParams(meetingParamsSchema, req.params);
    res.json(toMeetingDto(await meetings.get(getAuthenticatedUserId(res), id)));
  });

  router.patch('/:id', requireJsonContentType, async (req, res) => {
    const { id } = parseParams(meetingParamsSchema, req.params);
    const changes = parseBody(updateMeetingBodySchema, req.body);
    res.json(toMeetingDto(await meetings.update(getAuthenticatedUserId(res), id, changes)));
  });

  router.delete('/:id', async (req, res) => {
    const { id } = parseParams(meetingParamsSchema, req.params);
    await meetings.cancel(getAuthenticatedUserId(res), id);
    events.meetingCancelled(id); // ends the call for anyone in it
    res.status(204).end();
  });

  router.post('/:id/invitees', limiters.invite, requireJsonContentType, async (req, res) => {
    const { id } = parseParams(meetingParamsSchema, req.params);
    const { email } = parseBody(addInviteeBodySchema, req.body);
    const invitee = await meetings.addInvitee(getAuthenticatedUserId(res), id, email);
    res.status(201).json(toInviteeDto(invitee));
  });

  router.delete('/:id/invitees/:userId', async (req, res) => {
    const { id, userId } = parseParams(inviteeParamsSchema, req.params);
    await meetings.removeInvitee(getAuthenticatedUserId(res), id, userId);
    events.inviteeRemoved(id, userId); // a removed person (or one who left) is disconnected from the call
    res.status(204).end();
  });

  return router;
}
