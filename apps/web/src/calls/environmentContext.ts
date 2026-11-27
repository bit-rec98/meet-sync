import { createContext, useContext } from 'react';
import { createBrowserEnvironment } from './browserEnvironment';
import type { CallEnvironment } from './types';

/** Lets tests (and nothing else) replace the browser's camera, WebRTC and WebSocket with fakes. */
export const CallEnvironmentContext = createContext<CallEnvironment | null>(null);

let browserEnvironment: CallEnvironment | null = null;

/** The environment calls run in: the provided one, or the real browser's. */
export function useCallEnvironment(): CallEnvironment {
  const provided = useContext(CallEnvironmentContext);
  if (provided) return provided;
  browserEnvironment ??= createBrowserEnvironment();
  return browserEnvironment;
}
