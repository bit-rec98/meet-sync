import { Router, type Response } from 'express';
import { DomainError } from '../../errors.js';
import type { AuthService } from '../../services/authService.js';
import { noStore } from '../middleware/noStore.js';
import { originAllowlist } from '../middleware/originAllowlist.js';
import type { RateLimiters } from '../middleware/rateLimits.js';
import { getAuthenticatedUserId, requireAuth } from '../middleware/requireAuth.js';
import { requireJsonContentType } from '../middleware/requireJsonContentType.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../refreshCookie.js';
import { loginBodySchema, registerBodySchema } from '../schemas/auth.js';
import { parseBody } from '../validation.js';

export type AuthRouterDependencies = {
  auth: AuthService;
  limiters: RateLimiters;
  webOrigins: readonly string[];
  secureCookies: boolean;
  now: () => Date;
};

export function createAuthRouter({
  auth,
  limiters,
  webOrigins,
  secureCookies,
  now,
}: AuthRouterDependencies): Router {
  const router = Router();
  const onlyAllowedOrigins = originAllowlist(webOrigins);

  router.use(noStore); // these responses carry tokens

  const setCookie = (res: Response, token: string, expiresAt: Date): void => {
    setRefreshCookie(res, token, {
      maxAgeMs: Math.max(0, expiresAt.getTime() - now().getTime()),
      secure: secureCookies,
    });
  };

  router.post('/register', limiters.register, requireJsonContentType, async (req, res) => {
    const body = parseBody(registerBodySchema, req.body);
    const session = await auth.register(body);
    setCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
    res.status(201).json({ user: session.user, accessToken: session.accessToken });
  });

  router.post(
    '/login',
    limiters.loginPerIp,
    limiters.loginPerEmail,
    requireJsonContentType,
    async (req, res) => {
      const body = parseBody(loginBodySchema, req.body);
      const session = await auth.login(body);
      setCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
      res.json({ user: session.user, accessToken: session.accessToken });
    },
  );

  router.post('/refresh', limiters.refresh, onlyAllowedOrigins, async (req, res) => {
    try {
      const token = readRefreshCookie(req.headers.cookie);
      if (token === undefined) throw new DomainError('unauthorized');
      const refreshed = await auth.refresh(token);
      setCookie(res, refreshed.refreshToken, refreshed.refreshTokenExpiresAt);
      res.json({ accessToken: refreshed.accessToken });
    } catch (error) {
      // A rejected token is useless: have the browser drop it instead of resending it.
      if (error instanceof DomainError && error.code === 'unauthorized') {
        clearRefreshCookie(res, secureCookies);
      }
      throw error;
    }
  });

  router.post('/logout', onlyAllowedOrigins, async (req, res) => {
    const token = readRefreshCookie(req.headers.cookie);
    if (token !== undefined) await auth.logout(token);
    clearRefreshCookie(res, secureCookies);
    res.status(204).end();
  });

  router.get('/me', requireAuth(auth), async (_req, res) => {
    res.json({ user: await auth.getUser(getAuthenticatedUserId(res)) });
  });

  return router;
}
