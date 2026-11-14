import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { LibraryItem } from '@pagelet/contracts';
import { Badge } from '../components/Badge';
import { Button, LinkButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorNotice } from '../components/ErrorNotice';
import { Notice } from '../components/Notice';
import { AccountData } from './AccountData';
import { Skeleton } from '../components/Skeleton';
import { api, isApiError } from '../lib/api';
import { formatMoney } from '../lib/money';
import type { Receipt } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Load<T> = { kind: 'loading' } | { kind: 'ready'; data: T } | { kind: 'failed'; error: unknown };

const SIGN_IN_FOR_LIBRARY = `/account/sign-in?returnTo=${encodeURIComponent('/library')}`;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

const ORDER_STATUS: Record<string, { label: string; tone: 'success' | 'danger' | 'neutral' | 'info' }> = {
  paid: { label: 'Paid', tone: 'success' },
  partially_refunded: { label: 'Partly refunded', tone: 'info' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  disputed: { label: 'Payment under review', tone: 'danger' },
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
}

/** Customer shell: library, receipts and session controls. Lazy-loaded, out of the public entry bundle. */
export default function CustomerApp() {
  useDocumentTitle('My learning');
  const navigate = useNavigate();
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [library, setLibrary] = useState<Load<LibraryItem[]>>({ kind: 'loading' });
  const [orders, setOrders] = useState<Load<Receipt[]>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<{ busy: 'one' | 'all' | null; error?: unknown }>({ busy: null });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const onError = (error: unknown): boolean => {
      if (signal.aborted) return true;
      if (isApiError(error) && error.status === 401) {
        navigate(SIGN_IN_FOR_LIBRARY, { replace: true });
        return true;
      }
      return false;
    };
    setLibrary({ kind: 'loading' });
    setOrders({ kind: 'loading' });
    api<{ customer: { maskedEmail: string } }>('/api/me', { signal })
      .then((body) => setMaskedEmail(body?.customer?.maskedEmail ?? null))
      .catch((error: unknown) => void onError(error));
    api<{ items: LibraryItem[] }>('/api/library', { signal })
      .then((body) => setLibrary({ kind: 'ready', data: Array.isArray(body?.items) ? body.items : [] }))
      .catch((error: unknown) => {
        if (!onError(error)) setLibrary({ kind: 'failed', error });
      });
    api<{ items: Receipt[] }>('/api/orders', { signal })
      .then((body) => setOrders({ kind: 'ready', data: Array.isArray(body?.items) ? body.items : [] }))
      .catch((error: unknown) => {
        if (!onError(error)) setOrders({ kind: 'failed', error });
      });
    return () => controller.abort();
  }, [attempt, navigate]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  async function signOut(scope: 'one' | 'all') {
    setSession({ busy: scope });
    try {
      await api<void>(scope === 'all' ? '/api/me/sessions/revoke' : '/api/auth/logout', { method: 'POST' });
      navigate('/', { replace: true });
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        navigate('/', { replace: true });
        return;
      }
      setSession({ busy: null, error });
    }
  }

  const signedIn = library.kind === 'ready' || maskedEmail !== null;

  return (
    <div className="customer wrap">
      <div className="page-heading">
        <div>
          <h1 className="page-heading__title">My learning</h1>
          <p className="page-heading__lead">
            {maskedEmail ? (
              <>
                Signed in as <strong>{maskedEmail}</strong>. Purchases made with this address appear here.
              </>
            ) : (
              'Courses and downloads you have bought from this shop.'
            )}
          </p>
        </div>
        {signedIn ? (
          <Button variant="secondary" busy={session.busy === 'one'} busyLabel="Signing out…" onClick={() => signOut('one')}>
            Sign out
          </Button>
        ) : null}
      </div>
      {session.error ? <ErrorNotice title="We could not sign you out" error={session.error} /> : null}

      <section aria-labelledby="purchases-title" className="customer__section">
        <h2 id="purchases-title" className="customer__section-title">
          Your purchases
        </h2>
        {library.kind === 'loading' ? <Skeleton label="Loading your purchases" lines={3} /> : null}
        {library.kind === 'failed' ? <ErrorNotice title="Your purchases did not load" error={library.error} onRetry={retry} /> : null}
        {library.kind === 'ready' && library.data.length === 0 ? (
          <EmptyState title="No purchases yet" headingLevel={3} action={<LinkButton to="/">Browse the shop</LinkButton>}>
            <p>
              When you buy a course or download, it appears here. Paid a moment ago? Confirmation can take a minute.
              Bought with another email address? Sign out, then sign in with that address.
            </p>
          </EmptyState>
        ) : null}
        {library.kind === 'ready' && library.data.length > 0 ? (
          <ul className="library-list">
            {library.data.map((item) => (
              <li key={item.productId} className="library-item">
                <span className={`library-item__cover library-item__cover--${item.productType}`} aria-hidden="true" />
                <div className="library-item__text">
                  <h3 className="library-item__title">
                    {item.status === 'active' ? <Link to={`/learn/${item.slug}`}>{item.title}</Link> : item.title}
                  </h3>
                  <p className="library-item__meta">
                    {item.productType === 'course' ? 'Course' : 'Download'}, added{' '}
                    <time dateTime={item.grantedAt}>{formatDate(item.grantedAt)}</time>
                  </p>
                </div>
                {item.status === 'suspended' ? <Badge tone="danger">Access paused</Badge> : null}
                {item.status === 'revoked' ? <Badge>Access ended</Badge> : null}
                {item.status === 'active' ? (
                  <LinkButton to={`/learn/${item.slug}`} variant="secondary">
                    {item.productType === 'course' ? 'Open course' : 'Open files'}<span className="visually-hidden">: {item.title}</span>
                  </LinkButton>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {library.kind === 'ready' && library.data.some((i) => i.status !== 'active') ? (
          <Notice tone="info">
            <p>
              Paused access is usually a payment question being resolved. Ended access follows a refund. Files you
              already downloaded stay yours. Contact the shop if something looks wrong.
            </p>
          </Notice>
        ) : null}
      </section>

      <section aria-labelledby="receipts-title" className="customer__section">
        <h2 id="receipts-title" className="customer__section-title">
          Receipts
        </h2>
        {orders.kind === 'loading' ? <Skeleton label="Loading your receipts" lines={2} /> : null}
        {orders.kind === 'failed' ? <ErrorNotice title="Your receipts did not load" error={orders.error} onRetry={retry} /> : null}
        {orders.kind === 'ready' && orders.data.length === 0 ? (
          <p className="customer__empty">No receipts yet. Free products do not have receipts.</p>
        ) : null}
        {orders.kind === 'ready' && orders.data.length > 0 ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="receipts-title">
            <table className="receipts">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Items</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="receipts__amount">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.map((order) => {
                  const status = ORDER_STATUS[order.status] ?? { label: order.status, tone: 'neutral' as const };
                  return (
                    <tr key={order.id}>
                      <td><time dateTime={order.createdAt}>{formatDate(order.createdAt)}</time></td>
                      <td>{order.items.map((i) => i.title).join(', ')}</td>
                      <td><Badge tone={status.tone}>{status.label}</Badge></td>
                      <td className="receipts__amount tabular">
                        {formatMoney(order.total)}
                        {order.refunded.amountMinor > 0 ? (
                          <span className="receipts__refund">Refunded {formatMoney(order.refunded)}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {signedIn ? <AccountData onErased={() => navigate('/', { replace: true })} /> : null}

      {signedIn ? (
        <section aria-labelledby="security-title" className="customer__section">
          <h2 id="security-title" className="customer__section-title">
            Devices
          </h2>
          <p className="customer__empty">Signed in on a shared or lost device? Sign out everywhere, including here.</p>
          <Button variant="secondary" busy={session.busy === 'all'} busyLabel="Signing out everywhere…" onClick={() => signOut('all')}>
            Sign out on all devices
          </Button>
        </section>
      ) : null}
    </div>
  );
}
