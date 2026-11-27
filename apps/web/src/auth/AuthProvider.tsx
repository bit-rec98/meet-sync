import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createAuthApi, type LoginInput, type RegisterInput } from '../api/authApi';
import { createApiClient } from '../api/client';
import type { User } from '../api/types';
import { ApiClientContext, AuthContext, type AuthContextValue, type AuthStatus } from './context';

type SessionState = { status: AuthStatus; user: User | null };

type AuthProviderProps = {
  /** Replaces `fetch` (tests). */
  fetch?: typeof fetch;
  children: ReactNode;
};

/**
 * Owns the API client and the session. On load it asks the server for a new access token using the
 * refresh cookie; the token itself never leaves memory.
 */
export function AuthProvider({ fetch: fetchImpl, children }: AuthProviderProps) {
  const [session, setSession] = useState<SessionState>({ status: 'loading', user: null });
  const [sessionExpired, setSessionExpired] = useState(false);

  const client = useMemo(
    () =>
      createApiClient({
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
        onSessionExpired: () => {
          setSession({ status: 'anonymous', user: null });
          setSessionExpired(true);
        },
      }),
    [fetchImpl],
  );
  const authApi = useMemo(() => createAuthApi(client), [client]);

  useEffect(() => {
    let cancelled = false;
    // React StrictMode runs this effect twice in development. refreshSession() shares one
    // in-flight request, so the server never sees a refresh cookie used twice.
    void (async () => {
      try {
        await client.refreshSession();
        const user = await authApi.currentUser();
        if (!cancelled) setSession({ status: 'authenticated', user });
      } catch {
        if (!cancelled) setSession({ status: 'anonymous', user: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, authApi]);

  const login = useCallback(
    async (input: LoginInput) => {
      const user = await authApi.login(input);
      setSessionExpired(false);
      setSession({ status: 'authenticated', user });
    },
    [authApi],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const user = await authApi.register(input);
      setSessionExpired(false);
      setSession({ status: 'authenticated', user });
    },
    [authApi],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Best effort: the access token is already forgotten locally (see authApi.logout).
    } finally {
      setSession({ status: 'anonymous', user: null });
    }
  }, [authApi]);

  const value = useMemo<AuthContextValue>(
    () => ({ status: session.status, user: session.user, sessionExpired, login, register, logout }),
    [session, sessionExpired, login, register, logout],
  );

  return (
    <ApiClientContext.Provider value={client}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </ApiClientContext.Provider>
  );
}
