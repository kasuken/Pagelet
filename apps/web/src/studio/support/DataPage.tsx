import { useState } from 'react';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Notice } from '../../components/Notice';
import { Skeleton } from '../../components/Skeleton';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { AuditEvent } from '../../lib/types';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { StudioHeading } from '../common';
import { usePaged } from './usePaged';

const RETENTION_LABELS: Record<string, string> = {
  loginTokens: 'Expired sign-in links',
  freeClaimTokens: 'Expired free-claim links',
  sessions: 'Old sessions',
  rateLimits: 'Rate-limit counters',
  sentEmails: 'Emails sent over a year ago',
  processedWebhooks: 'Processed payment events over 400 days old',
};

function summarize(details: unknown): string {
  if (!details || typeof details !== 'object') return '';
  return Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join('; ');
}

/** O04 audit trail and data retention. */
export function DataPage() {
  useDocumentTitle('Audit and data');
  const { items, hasMore, status, error, loadMore, reload } = usePaged<AuditEvent>('/api/owner/audit');
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<Record<string, number> | null>(null);

  return (
    <>
      <StudioHeading title="Audit and data" lead="Every sensitive change is recorded here. Retention removes data whose purpose has ended; orders are never deleted." action={<Button variant="secondary" onClick={() => setConfirming(true)}>Run retention</Button>} />
      {report ? (
        <Notice tone="success" title="Retention finished" live="polite">
          <ul className="plain-list">{Object.entries(report).map(([k, v]) => <li key={k}><span>{RETENTION_LABELS[k] ?? k}</span><span className="tabular">{v} removed</span></li>)}</ul>
        </Notice>
      ) : null}
      <section className="studio-panel" aria-labelledby="audit-title">
        <h2 id="audit-title" className="studio-panel__title">Audit trail</h2>
        {status === 'loading' ? <Skeleton label="Loading the audit trail" lines={4} /> : null}
        {status === 'failed' ? <ErrorNotice title="The audit trail did not load" error={error} onRetry={reload} /> : null}
        {status !== 'loading' && status !== 'failed' && items.length === 0 ? <EmptyState title="No events yet" headingLevel={3}><p>Changes to products, access and settings appear here.</p></EmptyState> : null}
        {items.length > 0 ? (
          <>
            <ol className="row-list">
              {items.map((e) => (
                <li key={e.id} className="row-list__item">
                  <div className="row-list__main">
                    <p className="row-list__title">{e.action}</p>
                    <p className="row-list__meta">{formatDateTime(e.at)}, by {e.actor}, {e.subjectType} {e.subjectId}</p>
                    {summarize(e.details) ? <p className="row-list__meta">{summarize(e.details)}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
            {hasMore ? <Button variant="secondary" busy={status === 'more'} busyLabel="Loading…" onClick={loadMore}>Load older events</Button> : null}
          </>
        ) : null}
      </section>
      <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} title="Run data retention?" confirmLabel="Run retention" busyLabel="Running…" typedWord="RUN" onConfirm={async () => {
        setReport(await api<Record<string, number>>('/api/owner/retention', { method: 'POST', body: { confirm: 'RUN' } }));
        reload();
      }}>
        <p>Removes expired sign-in and claim links, old sessions, rate-limit counters, emails sent over a year ago and processed payment events over 400 days old. Orders, receipts and the audit trail are kept.</p>
      </ConfirmDialog>
    </>
  );
}
