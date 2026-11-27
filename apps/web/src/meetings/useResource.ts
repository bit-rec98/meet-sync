import { useEffect, useEffectEvent, useState } from 'react';

type Outcome<T> = { status: 'success'; data: T } | { status: 'error'; error: unknown };

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  /** `refreshing`: showing the previous data while a reload is in progress. */
  | { status: 'success'; data: T; refreshing: boolean };

/**
 * Loads data and keeps it in step with `key`: when the key changes, loading starts again; when
 * `reload()` is called, the previous data stays on screen until the new data arrives (so a page
 * does not blink after an action). Answers that arrive after the key changed, or after the
 * component went away, are ignored.
 */
export function useResource<T>(
  key: string,
  load: () => Promise<T>,
): { state: ResourceState<T>; reload: () => void } {
  const [reloads, setReloads] = useState(0);
  const [settled, setSettled] = useState<{
    key: string;
    reloads: number;
    outcome: Outcome<T>;
  } | null>(null);

  // `load` may change on every render; the effect below must only re-run for a new key or reload.
  const run = useEffectEvent(load);

  useEffect(() => {
    let cancelled = false;
    run().then(
      (data) => {
        if (!cancelled) setSettled({ key, reloads, outcome: { status: 'success', data } });
      },
      (error: unknown) => {
        if (!cancelled) setSettled({ key, reloads, outcome: { status: 'error', error } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, reloads]);

  let state: ResourceState<T> = { status: 'loading' };
  if (settled && settled.key === key) {
    const isCurrent = settled.reloads === reloads;
    if (settled.outcome.status === 'success') {
      state = { status: 'success', data: settled.outcome.data, refreshing: !isCurrent };
    } else if (isCurrent) {
      state = { status: 'error', error: settled.outcome.error };
    }
  }

  return { state, reload: () => setReloads((count) => count + 1) };
}
