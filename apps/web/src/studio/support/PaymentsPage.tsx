import { useState } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Notice } from '../../components/Notice';
import { Skeleton } from '../../components/Skeleton';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { OwnerWebhookFailure } from '../../lib/types';
import { useApiResource } from '../../lib/useApi';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { StudioHeading } from '../common';

type Report = Record<string, unknown> & { nextCursor?: string | null };

/** O02 payment events that failed to process, and reconciliation with Stripe. */
export function PaymentsPage() {
  useDocumentTitle('Payment events');
  const { state, reload } = useApiResource<{ items: OwnerWebhookFailure[] }>('/api/owner/webhooks');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function reconcile(startingAfter?: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api<Report>('/api/owner/reconciliation', { method: 'POST', body: startingAfter ? { startingAfter } : {} });
      setReport(result);
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StudioHeading title="Payment events" lead="Stripe notifications that could not be processed. Reconciliation finds paid checkouts that never granted access." action={<Button onClick={() => reconcile()} busy={busy} busyLabel="Checking Stripe…">Check for missed payments</Button>} />
      {error ? <ErrorNotice title="Reconciliation did not run" error={error} /> : null}
      {report ? (
        <Notice tone="success" title="Reconciliation finished" live="polite" actions={report.nextCursor ? <Button variant="secondary" onClick={() => reconcile(String(report.nextCursor))}>Check the next batch</Button> : undefined}>
          <dl className="facts facts--compact">
            {Object.entries(report).filter(([k, v]) => k !== 'nextCursor' && (typeof v === 'number' || typeof v === 'string')).map(([k, v]) => (
              <div key={k}><dt>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt><dd className="tabular">{String(v)}</dd></div>
            ))}
          </dl>
        </Notice>
      ) : null}
      {state.kind === 'loading' ? <Skeleton label="Loading payment events" lines={3} /> : null}
      {state.kind === 'failed' ? <ErrorNotice title="Payment events did not load" error={state.error} onRetry={reload} /> : null}
      {state.kind === 'ready' && state.data.items.length === 0 ? <EmptyState title="No failed payment events"><p>Every Stripe notification was processed.</p></EmptyState> : null}
      {state.kind === 'ready' && state.data.items.length > 0 ? (
        <ul className="row-list">
          {state.data.items.map((w) => (
            <li key={w.eventId} className="row-list__item">
              <div className="row-list__main">
                <p className="row-list__title">{w.type}</p>
                <p className="row-list__meta">{formatDateTime(w.receivedAt)}, event {w.eventId}</p>
                {w.reason ? <p className="row-list__meta">Reason: {w.reason}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
