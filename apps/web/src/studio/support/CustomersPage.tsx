import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Field } from '../../components/Field';
import { SelectField } from '../../components/FormControls';
import { Notice } from '../../components/Notice';
import { Skeleton } from '../../components/Skeleton';
import { api, isApiError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import type { OwnerCustomerDetail, OwnerCustomerRow, OwnerProduct } from '../../lib/types';
import { useApiResource } from '../../lib/useApi';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { OrderStatusBadge, StudioHeading } from '../common';

export function CustomersPage() {
  useDocumentTitle('Customers');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [term, setTerm] = useState(q);
  const { state, reload } = useApiResource<{ items: OwnerCustomerRow[] }>(`/api/owner/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  function submit(e: FormEvent) {
    e.preventDefault();
    setParams(term.trim() ? { q: term.trim() } : {}, { replace: true });
  }

  return (
    <>
      <StudioHeading title="Customers" lead="Find a buyer by the start of their email address." />
      <form className="inline-form search-form" role="search" onSubmit={submit}>
        <Field label="Email starts with" type="search" value={term} maxLength={254} spellCheck={false} onChange={(e) => setTerm(e.target.value)} />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {state.kind === 'loading' ? <Skeleton label="Searching customers" lines={3} /> : null}
      {state.kind === 'failed' ? <ErrorNotice title="Customers did not load" error={state.error} onRetry={reload} /> : null}
      {state.kind === 'ready' ? (
        <>
          <p className="collection__count" role="status">{state.data.items.length} {state.data.items.length === 1 ? 'customer' : 'customers'}{q ? ` matching “${q}”` : ''}</p>
          {state.data.items.length === 0 ? (
            <EmptyState title="No customers found"><p>{q ? 'Check the spelling, or search with fewer characters.' : 'Customers appear after their first purchase or free claim.'}</p></EmptyState>
          ) : (
            <div className="table-scroll" role="region" aria-label="Customers" tabIndex={0}>
              <table className="data-table">
                <thead><tr><th scope="col">Email</th><th scope="col" className="data-table__num">Orders</th><th scope="col">Since</th></tr></thead>
                <tbody>
                  {state.data.items.map((c) => (
                    <tr key={c.id}>
                      <td className="data-table__wrap"><Link to={`/studio/customers/${c.id}`}>{c.erased ? 'Erased customer' : c.email}</Link></td>
                      <td className="data-table__num tabular">{c.orders}</td>
                      <td>{formatDate(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}

type Grant = { grantId: string; productTitle: string };

/** O02 customer detail with O03 complimentary access and O04 erase. */
export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { state, reload } = useApiResource<OwnerCustomerDetail>(`/api/owner/customers/${encodeURIComponent(id)}`);
  const products = useApiResource<{ products: OwnerProduct[] }>('/api/owner/products?status=published');
  const [productId, setProductId] = useState('');
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [granting, setGranting] = useState(false);
  const [grantError, setGrantError] = useState<unknown>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const [erasing, setErasing] = useState(false);
  const [message, setMessage] = useState('');
  useDocumentTitle('Customer');
  const back = <Link to="/studio/customers">All customers</Link>;

  if (state.kind === 'loading') return <Skeleton label="Loading the customer" lines={4} />;
  if (state.kind === 'failed') return <><StudioHeading title="Customer" back={back} /><ErrorNotice title="The customer did not load" error={state.error} onRetry={reload} /></>;
  const c = state.data;
  const productList = products.state.kind === 'ready' ? products.state.data.products : [];
  const revocable = [
    ...grants,
    ...c.entitlements.flatMap((e) => (e.grants ?? []).filter((g) => g.source === 'complimentary' && g.status === 'active').map((g) => ({ grantId: g.id, productTitle: e.title }))),
  ].filter((g, i, all) => all.findIndex((x) => x.grantId === g.grantId) === i);

  async function grant(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!productId) errs.productId = 'Choose a product.';
    if (reason.trim().length < 3) errs.reason = 'Write a reason of at least 3 characters.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setGranting(true);
    setGrantError(null);
    try {
      const result = await api<{ grantId: string; status: string }>(`/api/owner/customers/${c.id}/complimentary`, { method: 'POST', body: { productId, reason: reason.trim() } });
      const title = productList.find((p) => p.id === productId)?.title ?? 'Product';
      setGrants((g) => [...g, { grantId: result.grantId, productTitle: title }]);
      setMessage(`Complimentary access to ${title} granted. The customer gets an email.`);
      setReason('');
      setProductId('');
      reload();
    } catch (err) {
      setGrantError(err);
    } finally {
      setGranting(false);
    }
  }

  return (
    <>
      <StudioHeading title={c.erased ? 'Erased customer' : c.email} back={back} />
      {message ? <Notice tone="success" live="polite"><p>{message}</p></Notice> : null}
      {c.erased ? <Notice tone="info"><p>This customer’s identity was erased. Their orders remain for your accounts.</p></Notice> : null}

      <section className="studio-panel" aria-labelledby="ent-title">
        <h2 id="ent-title" className="studio-panel__title">Access</h2>
        {c.entitlements.length === 0 ? <p className="studio-heading__lead">No products.</p> : (
          <ul className="plain-list">{c.entitlements.map((e) => <li key={e.productId}><span>{e.title}</span><Badge tone={e.status === 'active' ? 'success' : e.status === 'suspended' ? 'danger' : 'neutral'}>{e.status === 'active' ? 'Active' : e.status === 'suspended' ? 'Paused' : 'Ended'}</Badge></li>)}</ul>
        )}
      </section>

      <section className="studio-panel" aria-labelledby="orders-title">
        <h2 id="orders-title" className="studio-panel__title">Orders</h2>
        {c.orders.length === 0 ? <p className="studio-heading__lead">No orders.</p> : (
          <ul className="plain-list">{c.orders.map((o) => <li key={o.id}><Link to={`/studio/orders/${o.id}`}>{formatDate(o.createdAt)}<span className="visually-hidden">: order details</span></Link><OrderStatusBadge status={o.status} /><span className="tabular">{formatMoney(o.total)}</span></li>)}</ul>
        )}
      </section>

      {!c.erased ? (
        <section className="studio-panel" aria-labelledby="comp-title">
          <h2 id="comp-title" className="studio-panel__title">Complimentary access</h2>
          <p className="studio-heading__lead">Give a product without payment, for example to a reviewer. The reason is saved in the audit trail.</p>
          <form className="stack form-narrow" onSubmit={grant} noValidate>
            <SelectField label="Product" value={productId} error={fieldErrors.productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Choose a published product</option>
              {productList.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </SelectField>
            <Field label="Reason" value={reason} maxLength={300} error={fieldErrors.reason} onChange={(e) => setReason(e.target.value)} />
            <div className="form-actions"><Button type="submit" busy={granting} busyLabel="Granting…">Grant access</Button></div>
            {grantError ? (isApiError(grantError) && grantError.code === 'conflict' ? <Notice tone="info" title="Already granted"><p>{grantError.message}</p></Notice> : <ErrorNotice title="Access was not granted" error={grantError} />) : null}
          </form>
          {revocable.length > 0 ? (
            <>
              <h3 className="editor__section-title">Complimentary grants you can revoke</h3>
              <ul className="plain-list">{revocable.map((g) => <li key={g.grantId}><span>{g.productTitle}</span><Button variant="secondary" onClick={() => setRevoking(g)}>Revoke<span className="visually-hidden">: {g.productTitle}</span></Button></li>)}</ul>
            </>
          ) : null}
          <p className="field__description">Purchased access changes through refunds in Stripe, not here.</p>
        </section>
      ) : null}

      {!c.erased ? (
        <section className="studio-panel editor__section--danger" aria-labelledby="erase-title">
          <h2 id="erase-title" className="studio-panel__title">Erase personal data</h2>
          <p className="studio-heading__lead">For a deletion request. Removes the email and sessions; keeps orders without identity for your accounts. Access ends.</p>
          <Button variant="secondary" onClick={() => setErasing(true)}>Erase this customer</Button>
        </section>
      ) : null}

      <ConfirmDialog open={revoking !== null} onClose={() => setRevoking(null)} title="Revoke complimentary access?" confirmLabel="Revoke access" busyLabel="Revoking…" reasonLabel="Reason" onConfirm={async (r) => {
        if (!revoking) return;
        await api(`/api/owner/grants/${revoking.grantId}/revoke`, { method: 'POST', body: { reason: r } });
        setGrants((g) => g.filter((x) => x.grantId !== revoking.grantId));
        setMessage(`Access to ${revoking.productTitle} revoked.`);
        reload();
      }}>
        <p>{c.email} loses access to {revoking?.productTitle} unless they also bought it. Files they already downloaded stay with them.</p>
      </ConfirmDialog>
      <ConfirmDialog open={erasing} onClose={() => setErasing(false)} title="Erase this customer?" confirmLabel="Erase customer" busyLabel="Erasing…" typedWord="ERASE" onConfirm={async () => {
        await api(`/api/owner/customers/${c.id}/erase`, { method: 'POST', body: { confirm: 'ERASE' } });
        navigate('/studio/customers', { replace: true });
      }}>
        <p>{c.email} is removed, signed out everywhere and loses access to {c.entitlements.length} {c.entitlements.length === 1 ? 'product' : 'products'}. {c.orders.length} {c.orders.length === 1 ? 'order stays' : 'orders stay'} without identity. This cannot be undone.</p>
      </ConfirmDialog>
    </>
  );
}
