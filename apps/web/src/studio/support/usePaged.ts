import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Paged } from '../../lib/types';

/** Keyset paging: first page on load, "Load more" appends using nextCursor. */
export function usePaged<T>(basePath: string) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'more' | 'failed'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setItems([]);
    api<Paged<T>>(basePath, { signal: controller.signal })
      .then((page) => {
        setItems(page.items ?? []);
        setCursor(page.nextCursor ?? null);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(e);
        setStatus('failed');
      });
    return () => controller.abort();
  }, [basePath, attempt]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setStatus('more');
    try {
      const sep = basePath.includes('?') ? '&' : '?';
      const page = await api<Paged<T>>(`${basePath}${sep}cursor=${encodeURIComponent(cursor)}`);
      setItems((prev) => [...prev, ...(page.items ?? [])]);
      setCursor(page.nextCursor ?? null);
      setStatus('ready');
    } catch (e) {
      setError(e);
      setStatus('failed');
    }
  }, [basePath, cursor]);

  return { items, hasMore: cursor !== null, status, error, loadMore, reload: () => setAttempt((n) => n + 1) };
}
