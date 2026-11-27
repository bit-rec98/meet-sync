import type { RequestHandler } from 'express';
import { HttpError } from '../errorResponse.js';

/**
 * CSRF defense in depth for routes that rely on the refresh cookie (the cookie is also
 * SameSite=Strict). Browsers always send `Origin` on cross-origin POST requests, so a request
 * whose Origin is present but not allowed is refused. A missing Origin means a non-browser client
 * (curl, server-side code), which is not subject to cross-site request forgery.
 */
export function originAllowlist(allowedOrigins: readonly string[]): RequestHandler {
  return (req, _res, next) => {
    const origin = req.get('Origin');
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      next(new HttpError(403, 'forbidden'));
      return;
    }
    next();
  };
}
