import { useContext } from 'react';
import type { ApiClient } from '../api/client';
import { ApiClientContext, AuthContext, type AuthContextValue } from './context';

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** The API client shared by the whole app, already wired to the current session. */
export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) throw new Error('useApiClient must be used inside <AuthProvider>');
  return client;
}
