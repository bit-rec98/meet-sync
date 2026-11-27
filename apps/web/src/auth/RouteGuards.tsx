import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './useAuth';

function PageLoading() {
  const { t } = useTranslation();
  return (
    <div role="status" className="grid min-h-[40vh] place-items-center text-ink-muted">
      {t('common.loading')}
    </div>
  );
}

/**
 * Where to go after logging in: the page the user wanted, if it is a plain path of this site.
 * Anything else (a full URL, a protocol-relative "//host") falls back to the start page, so the
 * redirect can never leave the site.
 */
export function safeReturnPath(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const from = state.from;
    if (typeof from === 'object' && from !== null && 'pathname' in from) {
      const path = from.pathname;
      if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) return path;
    }
  }
  return '/';
}

/** Routes only for signed-in users; everyone else goes to the login page. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoading />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/** Login and registration: signed-in users are sent on to where they were going. */
export function RedirectIfAuthenticated() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageLoading />;
  if (status === 'authenticated') return <Navigate to={safeReturnPath(location.state)} replace />;
  return <Outlet />;
}
