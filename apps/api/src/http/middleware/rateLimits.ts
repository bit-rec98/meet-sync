import type { Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { sendError } from '../errorResponse.js';

export type RateLimitRule = { windowMs: number; limit: number };

export type RateLimitSettings = {
  register: RateLimitRule;
  loginPerIp: RateLimitRule;
  loginPerEmail: RateLimitRule;
  refresh: RateLimitRule;
  invite: RateLimitRule;
};

const MINUTE_MS = 60 * 1000;

/**
 * Limits from the feature spec. Counters live in memory, which is correct for the single API
 * instance this project runs (ADR-001) and resets when the process restarts.
 */
export const DEFAULT_RATE_LIMITS: RateLimitSettings = {
  register: { windowMs: 60 * MINUTE_MS, limit: 5 },
  loginPerIp: { windowMs: 15 * MINUTE_MS, limit: 10 },
  loginPerEmail: { windowMs: 15 * MINUTE_MS, limit: 5 },
  refresh: { windowMs: 15 * MINUTE_MS, limit: 30 },
  invite: { windowMs: 60 * MINUTE_MS, limit: 30 },
};

export type RateLimiters = {
  register: RequestHandler;
  loginPerIp: RequestHandler;
  loginPerEmail: RequestHandler;
  refresh: RequestHandler;
  invite: RequestHandler;
};

const MAX_EMAIL_KEY_LENGTH = 254;

const clientKey = (req: Request): string => `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;

/** Keys the counter by the email in the body (normalized like the schema does), else by client address. */
function emailOrClientKey(req: Request): string {
  const body: unknown = req.body;
  if (
    typeof body === 'object' &&
    body !== null &&
    'email' in body &&
    typeof body.email === 'string'
  ) {
    return `email:${body.email.trim().toLowerCase().slice(0, MAX_EMAIL_KEY_LENGTH)}`;
  }
  return clientKey(req);
}

/**
 * Keys the counter by the authenticated user, so one account cannot spam invitations from many
 * addresses. Must run after `requireAuth`; without a user it falls back to the client address.
 */
function userOrClientKey(req: Request, res: Response): string {
  const userId: unknown = res.locals['userId'];
  return typeof userId === 'string' ? `user:${userId}` : clientKey(req);
}

function limiter(
  rule: RateLimitRule,
  options: {
    keyGenerator: (req: Request, res: Response) => string;
    countOnlyFailures?: boolean;
  },
): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    keyGenerator: options.keyGenerator,
    // With this on, requests answered with a status below 400 are not counted.
    skipSuccessfulRequests: options.countOnlyFailures ?? false,
    standardHeaders: 'draft-7', // also makes the library send Retry-After when it rejects a request
    legacyHeaders: false,
    handler: (_req, res) => {
      sendError(res, 429, 'rate_limited');
    },
  });
}

/** Creates fresh counters, so each app instance (and each test) starts from zero. */
export function createRateLimiters(settings: RateLimitSettings): RateLimiters {
  return {
    register: limiter(settings.register, { keyGenerator: clientKey }),
    loginPerIp: limiter(settings.loginPerIp, { keyGenerator: clientKey, countOnlyFailures: true }),
    loginPerEmail: limiter(settings.loginPerEmail, {
      keyGenerator: emailOrClientKey,
      countOnlyFailures: true,
    }),
    refresh: limiter(settings.refresh, { keyGenerator: clientKey }),
    invite: limiter(settings.invite, { keyGenerator: userOrClientKey }),
  };
}
