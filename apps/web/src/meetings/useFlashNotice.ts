import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

/** A one-time message passed to the next page ("Meeting scheduled."). */
export type FlashNotice = 'created' | 'updated' | 'cancelled' | 'left';

const NOTICES: readonly FlashNotice[] = ['created', 'updated', 'cancelled', 'left'];

/** The navigation state that carries a notice to the next page. */
export const withNotice = (notice: FlashNotice): { notice: FlashNotice } => ({ notice });

function readNotice(state: unknown): FlashNotice | null {
  if (typeof state === 'object' && state !== null && 'notice' in state) {
    return NOTICES.find((candidate) => candidate === state.notice) ?? null;
  }
  return null;
}

/**
 * Returns the notice sent with the navigation to this page, and removes it from the history entry
 * so reloading the page does not show it again.
 */
export function useFlashNotice(): FlashNotice | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [notice] = useState(() => readNotice(location.state));

  useEffect(() => {
    if (notice) navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [notice, navigate, location.pathname, location.search]);

  return notice;
}
