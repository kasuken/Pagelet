import { useEffect } from 'react';

/** Adds <meta name="robots" content="noindex"> while mounted (missing products, private pages served by the SPA fallback). */
export function useNoIndex(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.append(meta);
    return () => meta.remove();
  }, [active]);
}
