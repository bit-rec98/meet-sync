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
import { createAuthService } from './services/authService.js';
import { createAccessTokenService } from './services/tokens.js';

export type AppDependencies = {
  pool: Pool;
  config: AppConfig;
  /** Clock used for token lifetimes; replaced in tests. */
  now?: () => Date;
  log?: Logger;
  rateLimits?: RateLimitSettings;
};

export function createApp({
  pool,
  config,
  now = () => new Date(),
  log = consoleLogger,
  rateLimits = DEFAULT_RATE_LIMITS,
}: AppDependencies): Express {
  const auth = createAuthService({
    pool,
    accessTokens: createAccessTokenService(config.accessTokenSecret),
    now,
  });

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
      limiters: createRateLimiters(rateLimits),
      webOrigins: config.webOrigins,
      secureCookies: config.secureCookies,
      now,
    }),
  );

  app.use(handleNotFound);
  app.use(createErrorHandler(log));

  return app;
}
