import type { Media } from '@meet-sync/signaling-protocol';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createCallSession } from './callSession';
import { useCallEnvironment } from './environmentContext';
import type { CallState } from './types';
import { useCallsApi } from './useCallsApi';

export type UseCall = {
  state: CallState;
  start(media: Media): void;
  toggleMicrophone(): void;
  toggleCamera(): void;
  leave(): void;
  /** Back to the lobby with a fresh session, after a call ended. */
  reset(): void;
};

/**
 * One call session for the screen showing a meeting's call (the screen is keyed by the meeting, so
 * the meeting never changes while it is mounted). Leaving the screen ends the call and releases the
 * camera and microphone.
 *
 * React's development mode mounts, unmounts and remounts every component once to expose cleanup
 * bugs. Ending the session on that first unmount would break the remount, so the end is postponed by
 * a moment and cancelled if the screen comes back.
 */
export function useCall(meetingId: string): UseCall {
  const environment = useCallEnvironment();
  const api = useCallsApi();
  const [session, setSession] = useState(() => createCallSession({ environment, api, meetingId }));
  const pendingDispose = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(pendingDispose.current);
    return () => {
      pendingDispose.current = setTimeout(() => session.dispose(), 0);
    };
  }, [session]);

  const state = useSyncExternalStore(session.subscribe, session.getState);

  const reset = useCallback(() => {
    session.dispose();
    setSession(createCallSession({ environment, api, meetingId }));
  }, [session, environment, api, meetingId]);

  return {
    state,
    start: useCallback((media) => void session.start(media), [session]),
    toggleMicrophone: session.toggleMicrophone,
    toggleCamera: session.toggleCamera,
    leave: session.leave,
    reset,
  };
}
