import { useMemo } from 'react';
import { createMeetingsApi, type MeetingsApi } from '../api/meetingsApi';
import { useApiClient } from '../auth/useAuth';

/** The meetings API, bound to the app's client (and so to the current session). */
export function useMeetingsApi(): MeetingsApi {
  const client = useApiClient();
  return useMemo(() => createMeetingsApi(client), [client]);
}
