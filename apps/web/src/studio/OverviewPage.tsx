import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LinkButton } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { Notice } from '../components/Notice';
import { Skeleton } from '../components/Skeleton';
import { api } from '../lib/api';
import { formatMoney } from '../lib/money';
import type { OwnerOverview } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { requirementLabel } from './requirements';

type Load = { kind: 'loading' } | { kind: 'ready'; data: OwnerOverview } | { kind: 'failed'; error: unknown };

export function OverviewPage({ provider }: { provider: string }) {
  useDocumentTitle('Studio overview');
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    api<OwnerOverview>('/api/owner/overview', { signal: controller.signal })
      .then((data) => setState({ kind: 'ready', data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'failed', error });
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <>
      <div className="studio-heading">
        <div>
          <h1 className="studio-title">Overview</h1>
          <p className="studio-heading__lead">Signed in as the owner with {provider}.</p>
        </div>
        <LinkButton to="/studio/products?new=1">Create a product</LinkButton>
      </div>

      {state.kind === 'loading' ? <Skeleton label="Loading your shop overview" lines={3} /> : null}
      {state.kind === 'failed' ? (
        <ErrorNotice title="The overview did not load" error={state.error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : null}
      {state.kind === 'ready' ? <OverviewBody data={state.data} /> : null}

    </>
  );
}

function count(record: Partial<Record<string, number>> | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function OverviewBody({ data }: { data: OwnerOverview }) {
  const sales = data.salesLast30Days;
  const published = count(data.products, 'published');
  const drafts = count(data.products, 'draft');
  const failedEmails = count(data.emails, 'failed');
  const pendingEmails = count(data.emails, 'pending');
  const missing = Array.isArray(data.missingLaunchRequirements) ? data.missingLaunchRequirements : [];
  const attention = [
    data.openDisputes > 0 ? `${data.openDisputes} open ${data.openDisputes === 1 ? 'dispute' : 'disputes'}. Respond in your Stripe dashboard; access is paused until it is resolved.` : null,
    data.failedWebhooks > 0 ? `${data.failedWebhooks} payment ${data.failedWebhooks === 1 ? 'event' : 'events'} failed to process. Run reconciliation so no buyer is left without access.` : null,
    failedEmails > 0 ? `${failedEmails} ${failedEmails === 1 ? 'email' : 'emails'} could not be sent.` : null,
  ].filter((x): x is string => x !== null);

  return (
    <>
      {!data.checkoutReady ? (
        <Notice tone="danger" title="Checkout is not ready yet" live="off" actions={<Link className="button button--secondary" to="/studio/settings">Open settings</Link>}>
          <p>Visitors cannot buy until these settings are complete:</p>
          <ul className="requirements">
            {missing.map((key) => (
              <li key={key}>{requirementLabel(key)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <dl className="metrics">
        <div className="metrics__item">
          <dt>Sales, last 30 days</dt>
          <dd className="metrics__value tabular">
            {sales.currency ? formatMoney({ amountMinor: sales.grossMinor, currency: sales.currency }) : formatPlain(0)}
          </dd>
          <dd className="metrics__note">Gross, before fees and refunds</dd>
        </div>
        <div className="metrics__item">
          <dt>Orders, last 30 days</dt>
          <dd className="metrics__value tabular">{formatPlain(sales.count)}</dd>
        </div>
        <div className="metrics__item">
          <dt>Published products</dt>
          <dd className="metrics__value tabular">{formatPlain(published)}</dd>
          <dd className="metrics__note">
            {drafts} {drafts === 1 ? 'draft' : 'drafts'}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="attention-title" className="studio-panel">
        <h2 id="attention-title" className="studio-panel__title">
          Needs attention
        </h2>
        {attention.length === 0 ? (
          <p className="studio-heading__lead">
            Nothing needs your attention.{pendingEmails > 0 ? ` ${pendingEmails} ${pendingEmails === 1 ? 'email is' : 'emails are'} waiting to send.` : ''}
          </p>
        ) : (
          <ul className="attention-list">
            {attention.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

const plain = new Intl.NumberFormat();
function formatPlain(n: number): string {
  return plain.format(n);
}
