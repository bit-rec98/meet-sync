import type { RequestHandler } from 'express';
import { HttpError } from '../errorResponse.js';

function hasRequestBody(headers: Record<string, string | string[] | undefined>): boolean {
  return headers['transfer-encoding'] !== undefined || Number(headers['content-length'] ?? 0) > 0;
}

/**
 * Rejects bodies that are not JSON with 415. JSON-only bodies also mean a plain cross-site HTML
 * form (which cannot send `application/json`) cannot reach these routes. A request without any body
 * passes through, so the schema validation can answer it with a 400.
 */
export const requireJsonContentType: RequestHandler = (req, _res, next) => {
  if (hasRequestBody(req.headers) && !req.is('application/json')) {
    next(new HttpError(415, 'unsupported_media_type'));
    return;
  }
  next();
};
