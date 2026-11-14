import { useCallback, useRef, useState } from 'react';
import { api } from '../lib/api';

export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: number } | { kind: 'failed'; error: unknown };

export function clampResume(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.min(86_400, Math.floor(seconds));
}

/**
 * Saves lesson progress with PUT /api/lessons/{id}/progress. The UI shows "Saved" only after the
 * server confirms; overlapping saves are coalesced so the latest position wins.
 */
export function useProgress(lessonId: string) {
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const inFlight = useRef(false);
  const queued = useRef<{ resumeSeconds: number; completed?: boolean; keepalive?: boolean } | null>(null);
  const lastSaved = useRef<number | null>(null);

  const flush = useCallback(async (): Promise<boolean> => {
    if (inFlight.current || !queued.current) return false;
    const body = queued.current;
    queued.current = null;
    inFlight.current = true;
    setState({ kind: 'saving' });
    try {
      await api(`/api/lessons/${encodeURIComponent(lessonId)}/progress`, {
        method: 'PUT',
        body: { resumeSeconds: body.resumeSeconds, ...(body.completed !== undefined ? { completed: body.completed } : {}) },
        keepalive: body.keepalive,
      });
      lastSaved.current = body.resumeSeconds;
      setState({ kind: 'saved', at: Date.now() });
      return true;
    } catch (error) {
      setState({ kind: 'failed', error });
      return false;
    } finally {
      inFlight.current = false;
      if (queued.current) void flush();
    }
  }, [lessonId]);

  const save = useCallback(
    (resumeSeconds: number, options: { completed?: boolean; keepalive?: boolean; force?: boolean } = {}) => {
      const seconds = clampResume(resumeSeconds);
      // Skip position-only saves that would not change anything.
      if (!options.force && options.completed === undefined && lastSaved.current !== null && Math.abs(lastSaved.current - seconds) < 2) return Promise.resolve(true);
      const previous = queued.current;
      queued.current = { resumeSeconds: seconds, completed: options.completed ?? previous?.completed, keepalive: options.keepalive };
      return flush();
    },
    [flush],
  );

  return { state, save };
}
