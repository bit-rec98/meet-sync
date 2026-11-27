import type { RequestHandler } from 'express';

/** Responses with tokens or personal data must never be stored by browsers or proxies. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};
