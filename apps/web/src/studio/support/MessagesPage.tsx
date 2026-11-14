import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Skeleton } from '../../components/Skeleton';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { OwnerEmail } from '../../lib/types';
import { useApiResource } from '../../lib/useApi';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { StudioHeading } from '../common';

const TEMPLATE: Record<string, string> = {
  login_link: 'Sign-in link',
  free_claim: 'Free product confirmation',
  purchase_access: 'Purchase access',
  access_revoked: 'Access ended',
  access_granted: 'Complimentary access',
};

const RESULT: Record<string, string> = {
  sent: 'Sent.',
  failed: 'Still failing. Check the email provider settings.',
  not_retryable: 'Not retried: sign-in and claim links expire. The customer can request a new one.',
};

/** O02 email outbox: failed and pending messages, with retry. */
export function MessagesPage() {
  useDocumentTitle('Emails');
  const [params, setParams] = useSearchParams();
  const status = params.get('status') === 'pending' ? 'pending' : 'failed';
  const { state, reload } = useApiResource<{ items: OwnerEmail[] }>(`/api/owner/emails?status=${status}`);
  const [results, setResults] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function retry(email: OwnerEmail) {
    setBusy(email.id);
    setError(null);
    try {
      const { result } = await api<{ result: string }>(`/api/owner/emails/${email.id}/retry`, { method: 'POST', body: {} });
      setResults((r) => ({ ...r, [email.id]: RESULT[result] ?? result }));
      if (result === 'sent') reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <StudioHeading title="Emails" lead="Messages that could not be delivered, or are waiting to send." />
      <div className="filters" role="group" aria-label="Email status">
        {(['failed', 'pending'] as const).map((s) => (
          <button key={s} type="button" className="filters__option" aria-pressed={status === s} onClick={() => setParams(s === 'failed' ? {} : { status: s }, { replace: true })}>{s === 'failed' ? 'Failed' : 'Waiting'}</button>
        ))}
      </div>
      {error ? <ErrorNotice title="Retry did not run" error={error} /> : null}
      {state.kind === 'loading' ? <Skeleton label="Loading emails" lines={3} /> : null}
      {state.kind === 'failed' ? <ErrorNotice title="Emails did not load" error={state.error} onRetry={reload} /> : null}
      {state.kind === 'ready' && state.data.items.length === 0 ? <EmptyState title={status === 'failed' ? 'No failed emails' : 'Nothing waiting'}><p>Every message has been delivered.</p></EmptyState> : null}
      {state.kind === 'ready' && state.data.items.length > 0 ? (
        <ul className="row-list">
          {state.data.items.map((m) => (
            <li key={m.id} className="row-list__item">
              <div className="row-list__main">
                <p className="row-list__title">{TEMPLATE[m.template] ?? m.template}</p>
                <p className="row-list__meta">To {m.recipient}, {formatDateTime(m.createdAt)}, {m.attempts} {m.attempts === 1 ? 'attempt' : 'attempts'}</p>
                {m.lastError ? <p className="row-list__meta">Last error: {m.lastError}</p> : null}
                <p className="save-status" role="status">{results[m.id] ?? ''}</p>
              </div>
              {m.status === 'failed' ? <Button variant="secondary" busy={busy === m.id} busyLabel="Retrying…" onClick={() => retry(m)}>Retry<span className="visually-hidden">: email to {m.recipient}</span></Button> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
