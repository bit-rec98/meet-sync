import type { Response } from 'express';

const COOKIE_NAME = 'refresh_token';
// The browser sends the cookie only to the auth routes, never to the rest of the API.
const COOKIE_PATH = '/api/v1/auth';

type CookieAttributes = { httpOnly: true; secure: boolean; sameSite: 'strict'; path: string };

const attributes = (secure: boolean): CookieAttributes => ({
  httpOnly: true, // not readable by page scripts, which limits the impact of XSS
  secure,
  sameSite: 'strict',
  path: COOKIE_PATH,
});

export function setRefreshCookie(
  res: Response,
  token: string,
  options: { maxAgeMs: number; secure: boolean },
): void {
  res.cookie(COOKIE_NAME, token, { ...attributes(options.secure), maxAge: options.maxAgeMs });
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.clearCookie(COOKIE_NAME, attributes(secure));
}

/**
 * Reads the refresh token from a `Cookie` header. The value is untrusted: the caller must still
 * check its shape and look it up. Returns undefined when the cookie is absent.
 */
export function readRefreshCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === COOKIE_NAME) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}
