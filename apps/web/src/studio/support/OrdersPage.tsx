import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Skeleton } from '../../components/Skeleton';
import { formatDate, formatDateTime } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import type { OwnerOrderDetail, OwnerOrderRow } from '../../lib/types';
import { useApiResource } from '../../lib/useApi';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { OrderStatusBadge, StudioHeading } from '../common';
import { usePaged } from './usePaged';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'partially_refunded', label: 'Partly refunded' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'disputed', label: 'Disputed' },
];

export function OrdersPage() {
  useDocumentTitle('Orders');
  const [params, setParams] = useSearchParams();
  const status = FILTERS.find((f) => f.value === params.get('status'))?.value ?? '';
  const { items, hasMore, status: load, error, loadMore, reload } = usePaged<OwnerOrderRow>(`/api/owner/orders${status ? `?status=${status}` : ''}`);

  return (
    <>
      <StudioHeading title="Orders" lead="Refunds and disputes are handled in your Stripe dashboard; their status appears here." action={<a className="button button--secondary" href="https://dashboard.stripe.com/payments" target="_blank" rel="noopener noreferrer">Open Stripe<span className="visually-hidden"> (opens in a new tab)</span></a>} />
      <div className="filters" role="group" aria-label="Filter orders">
        {FILTERS.map((f) => (
          <button key={f.value || 'all'} type="button" className="filters__option" aria-pressed={status === f.value} onClick={() => setParams(f.value ? { status: f.value } : {}, { replace: true })}>{f.label}</button>
        ))}
      </div>
      {load === 'loading' ? <Skeleton label="Loading orders" lines={3} /> : null}
      {load === 'failed' ? <ErrorNotice title="Orders did not load" error={error} onRetry={reload} /> : null}
      {load !== 'loading' && load !== 'failed' && items.length === 0 ? (
        <EmptyState title={status ? 'No orders with this status' : 'No orders yet'}><p>{status ? 'Try another filter.' : 'Paid orders appear here as soon as Stripe confirms them.'}</p></EmptyState>
      ) : null}
      {items.length > 0 ? (
        <>
          <p className="visually-hidden" role="status">{items.length} orders shown</p>
          <div className="table-scroll" role="region" aria-label="Orders" tabIndex={0}>
            <table className="data-table">
              <thead><tr><th scope="col">Date</th><th scope="col">Customer</th><th scope="col">Products</th><th scope="col">Status</th><th scope="col" className="data-table__num">Total</th></tr></thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id}>
                    <td><Link to={`/studio/orders/${o.id}`}>{formatDate(o.createdAt)}<span className="visually-hidden">: order details</span></Link></td>
                    <td className="data-table__wrap">{o.customerEmail}</td>
                    <td className="data-table__wrap">{o.titles}</td>
                    <td><OrderStatusBadge status={o.status} /></td>
                    <td className="data-table__num tabular">{formatMoney(o.total)}{o.refundedMinor > 0 ? <span className="data-table__secondary">−{formatMoney({ amountMinor: o.refundedMinor, currency: o.total.currency })}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore ? <Button variant="secondary" busy={load === 'more'} busyLabel="Loading…" onClick={loadMore}>Load more orders</Button> : null}
        </>
      ) : null}
    </>
  );
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { state, reload } = useApiResource<OwnerOrderDetail>(`/api/owner/orders/${encodeURIComponent(id)}`);
  useDocumentTitle('Order');
  const back = <Link to="/studio/orders">All orders</Link>;
  if (state.kind === 'loading') return <Skeleton label="Loading the order" lines={4} />;
  if (state.kind === 'failed') return <><StudioHeading title="Order" back={back} /><ErrorNotice title="The order did not load" error={state.error} onRetry={reload} /></>;
  const o = state.data;
  const currency = o.total.currency;
  return (
    <>
      <StudioHeading title={`Order from ${formatDate(o.createdAt)}`} back={back} lead={<span className="workspace__meta"><OrderStatusBadge status={o.status} /><span>{o.customerEmail}</span></span>} action={<Link className="button button--secondary" to={`/studio/customers?q=${encodeURIComponent(o.customerEmail)}`}>Find customer</Link>} />
      <dl className="facts">
        <div><dt>Total</dt><dd className="tabular">{formatMoney(o.total)}</dd></div>
        <div><dt>Refunded</dt><dd className="tabular">{formatMoney({ amountMinor: o.refundedMinor, currency })}</dd></div>
        <div><dt>Placed</dt><dd>{formatDateTime(o.createdAt)}</dd></div>
        <div><dt>Policy version</dt><dd>{o.policyVersion ?? 'Not recorded'}</dd></div>
        {o.providerPaymentId ? <div><dt>Stripe payment</dt><dd className="data-table__wrap">{o.providerPaymentId}</dd></div> : null}
      </dl>
      <section className="studio-panel" aria-labelledby="items-title">
        <h2 id="items-title" className="studio-panel__title">Items</h2>
        <ul className="plain-list">{o.items.map((i) => <li key={i.productId}><span>{i.title}</span><span className="tabular">{formatMoney({ amountMinor: i.unitPriceMinor, currency })}</span></li>)}</ul>
      </section>
      <section className="studio-panel" aria-labelledby="access-title">
        <h2 id="access-title" className="studio-panel__title">Access</h2>
        {o.grants.length === 0 ? <p className="studio-heading__lead">No access grants are linked to this order.</p> : (
          <ul className="plain-list">{o.grants.map((g) => <li key={g.id}><span>{g.source === 'purchase' ? 'Purchase' : g.source}{g.reason ? `: ${g.reason}` : ''}</span><Badge tone={g.status === 'active' ? 'success' : g.status === 'suspended' ? 'danger' : 'neutral'}>{g.status}</Badge></li>)}</ul>
        )}
      </section>
      <section className="studio-panel" aria-labelledby="refunds-title">
        <h2 id="refunds-title" className="studio-panel__title">Refunds</h2>
        {o.refunds.length === 0 ? <p className="studio-heading__lead">No refunds. Create refunds in Stripe; full refunds end access automatically.</p> : (
          <ul className="plain-list">{o.refunds.map((r) => <li key={r.id}><span>{formatDateTime(r.createdAt)}</span><span className="tabular">{formatMoney({ amountMinor: r.amountMinor, currency })}</span></li>)}</ul>
        )}
      </section>
    </>
  );
}
