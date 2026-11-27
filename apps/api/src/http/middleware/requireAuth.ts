import type { RequestHandler, Response } from 'express';
import { DomainError } from '../../errors.js';
import type { AuthService } from '../../services/authService.js';

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

/**
 * Requires `Authorization: Bearer <access token>`. On success the user id is available through
 * {@link getAuthenticatedUserId}. Every failure produces the same 401, whatever the reason.
 */
export function requireAuth(auth: AuthService): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = BEARER_PATTERN.exec(req.get('Authorization') ?? '')?.[1];
      if (token === undefined) throw new DomainError('unauthorized');
      res.locals['userId'] = await auth.authenticate(token);
      next();
    } catch (error) {
      res.set('WWW-Authenticate', 'Bearer');
      next(error);
    }
  };
}

/** The id of the user authenticated by {@link requireAuth}. Throws if that middleware did not run. */
export function getAuthenticatedUserId(res: Response): string {
  const userId: unknown = res.locals['userId'];
  if (typeof userId !== 'string') throw new DomainError('unauthorized');
  return userId;
}
