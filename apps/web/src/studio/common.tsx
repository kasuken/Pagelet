import { useEffect, type ReactNode } from 'react';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Notice } from '../components/Notice';
import { isApiError } from '../lib/api';
import type { ProductStatus } from '../lib/types';

export function StudioHeading({ title, lead, action, back }: { title: string; lead?: ReactNode; action?: ReactNode; back?: ReactNode }) {
  return (
    <div className="studio-heading">
      <div className="studio-heading__text">
        {back ? <p className="studio-heading__back">{back}</p> : null}
        <h1 className="studio-title">{title}</h1>
        {lead ? <p className="studio-heading__lead">{lead}</p> : null}
      </div>
      {action ? <div className="studio-heading__action">{action}</div> : null}
    </div>
  );
}

const STATUS: Record<ProductStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  published: { label: 'Published', tone: 'success' },
  archived: { label: 'Archived', tone: 'info' },
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const ORDER: Record<string, { label: string; tone: BadgeTone }> = {
  paid: { label: 'Paid', tone: 'success' },
  partially_refunded: { label: 'Partly refunded', tone: 'info' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  disputed: { label: 'Disputed', tone: 'danger' },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const s = ORDER[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const LEAVE_MESSAGE = 'You have unsaved changes. Leave this page and discard them?';

/**
 * Warns before leaving with unsaved edits: on reload or tab close (beforeunload) and on in-app link clicks
 * (a capture-phase guard that runs before the router). The browser Back button is not intercepted.
 */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.origin !== window.location.origin) return;
      if (link.pathname === window.location.pathname && link.search === window.location.search) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
}

/** A 409 without field issues: possibly a stale revision (confirm with isNewerOnServer). */
export function isStaleConflict(error: unknown): boolean {
  return isApiError(error) && error.code === 'conflict' && error.issues.length === 0;
}

/** Marks a 409 as stale only when the server really has a newer revision than the one the owner edited. */
export class StaleRevisionError extends Error {
  constructor(readonly cause: unknown) {
    super('stale');
  }
}

export function StaleNotice({ error: wrapped, onReload }: { error: unknown; onReload: () => void }) {
  const error = wrapped instanceof StaleRevisionError ? wrapped.cause : wrapped;
  const raw = isApiError(error) ? error.message.trim() : '';
  const message = raw && !/[.!?]$/.test(raw) ? `${raw}.` : raw;
  return (
    <Notice
      tone="danger"
      title="This product changed since you opened it"
      live="assertive"
      requestId={isApiError(error) ? error.requestId : undefined}
      actions={<Button onClick={onReload}>Reload the latest version</Button>}
    >
      <p>{message || 'Someone saved a newer version.'} Reloading replaces the unsaved edits on this screen.</p>
    </Notice>
  );
}

/** Maps API validation issues ({ path, message }) to a field lookup. */
export function issuesByPath(error: unknown): Record<string, string> {
  if (!isApiError(error)) return {};
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.split('.')[0] ?? issue.path;
    if (!out[issue.path]) out[issue.path] = issue.message;
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** "My first course!" -> "my-first-course" */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}
