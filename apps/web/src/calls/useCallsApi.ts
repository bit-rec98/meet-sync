import { useMemo } from 'react';
import { createCallsApi, type CallsApi } from '../api/callsApi';
import { useApiClient } from '../auth/useAuth';

/** The calls API, bound to the app's client (and so to the current session). */
export function useCallsApi(): CallsApi {
  const client = useApiClient();
  return useMemo(() => createCallsApi(client), [client]);
}
