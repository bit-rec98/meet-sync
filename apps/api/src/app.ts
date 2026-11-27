import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Pool } from 'mysql2/promise';
import type { AppConfig } from './config/env.js';
import { createErrorHandler, handleNotFound } from './http/errorHandler.js';
import { consoleLogger, requestLogger, type Logger } from './http/logger.js';
import {
  createRateLimiters,
  DEFAULT_RATE_LIMITS,
  type RateLimitSettings,
} from './http/middleware/rateLimits.js';
import { createAuthRouter } from './http/routes/authRoutes.js';
import { createMeetingRouter } from './http/routes/meetingRoutes.js';
import { createSignalingRouter } from './http/routes/signalingRoutes.js';
import { createMeetingEvents, type MeetingEvents } from './meetingEvents.js';
import { createAuthService, type AuthService } from './services/authService.js';
import { createMeetingService, type MeetingService } from './services/meetingService.js';
import { createAccessTokenService } from './services/tokens.js';
import { createTicketStore, type TicketStore } from './signaling/tickets.js';

/**
 * The parts shared by the HTTP app and the WebSocket signaling server: the services that hold
 * the rules, the single-use tickets that link the two, and the events that let REST actions
 * disconnect people from a call.
 */
export type AppServices = {
  auth: AuthService;
  meetings: MeetingService;
  tickets: TicketStore;
  events: MeetingEvents;
};

export type ServiceDependencies = {
  pool: Pool;
  config: AppConfig;
  /** Clock used for token and ticket lifetimes and for the meeting rules; replaced in tests. */
  now?: () => Date;
  log?: Logger;
};

export function createServices({
  pool,
  config,
  now = () => new Date(),
  log = consoleLogger,
}: ServiceDependencies): AppServices {
  return {
    auth: createAuthService({
      pool,
      accessTokens: createAccessTokenService(config.accessTokenSecret),
      now,
    }),
    meetings: createMeetingService({ pool, now }),
    tickets: createTicketStore({ now }),
    events: createMeetingEvents((error) => {
      log({
        event: 'meeting_event_error',
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }),
  };
}

export type AppDependencies = ServiceDependencies & {
  rateLimits?: RateLimitSettings;
  /** Build them with {@link createServices} to share them with the signaling server. */
  services?: AppServices;
};

export function createApp({
  pool,
  config,
  now = () => new Date(),
  log = consoleLogger,
  rateLimits = DEFAULT_RATE_LIMITS,
  services = createServices({ pool, config, now, log }),
}: AppDependencies): Express {
  const { auth, meetings, tickets, events } = services;
  const limiters = createRateLimiters(rateLimits);

  const app = express();
  app.disable('x-powered-by');
  // Number of trusted reverse proxies, so rate limits see the real client address when deployed.
  app.set('trust proxy', config.trustProxyHops);

  app.use(requestLogger(log));
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(
    '/api/v1/auth',
    createAuthRouter({
      auth,
      limiters,
      webOrigins: config.webOrigins,
      secureCookies: config.secureCookies,
      now,
    }),
  );
  app.use('/api/v1/meetings', createMeetingRouter({ auth, meetings, limiters, events }));
  app.use(
    '/api/v1',
    createSignalingRouter({ auth, meetings, tickets, config: config.signaling, limiters, now }),
  );

  app.use(handleNotFound);
  app.use(createErrorHandler(log));

  return app;
}
