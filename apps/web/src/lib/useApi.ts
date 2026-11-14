import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export type Resource<T> = { kind: 'loading' } | { kind: 'ready'; data: T } | { kind: 'failed'; error: unknown };

/**
 * Loads one GET endpoint, aborting on unmount or when the path changes. Pass null to skip loading.
 * `reload()` fetches again; `set()` replaces the data locally after a successful mutation.
 */
export function useApiResource<T>(path: string | null) {
  const [state, setState] = useState<Resource<T>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setState((previous) => (previous.kind === 'ready' && attempt > 0 ? previous : { kind: 'loading' }));
    api<T>(path, { signal: controller.signal })
      .then((data) => setState({ kind: 'ready', data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'failed', error });
      });
    return () => controller.abort();
  }, [path, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const set = useCallback((data: T) => setState({ kind: 'ready', data }), []);
  return { state, reload, set };
}
