import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Field } from '../../components/Field';
import { RadioGroup } from '../../components/FormControls';
import { Notice } from '../../components/Notice';
import { Skeleton } from '../../components/Skeleton';
import { api, isApiError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import type { OwnerProduct, ProductStatus } from '../../lib/types';
import { useApiResource } from '../../lib/useApi';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { issuesByPath, ProductStatusBadge, slugify, StudioHeading } from '../common';

const FILTERS: Array<{ value: '' | ProductStatus; label: string }> = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

export function ProductsPage() {
  useDocumentTitle('Products');
  const [params, setParams] = useSearchParams();
  const status = (FILTERS.find((f) => f.value === params.get('status'))?.value ?? '') as '' | ProductStatus;
  const { state, reload } = useApiResource<{ products: OwnerProduct[] }>(`/api/owner/products${status ? `?status=${status}` : ''}`);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const products = state.kind === 'ready' ? state.data.products : [];

  return (
    <>
      <StudioHeading title="Products" lead="Courses and downloads, in any state." action={<Button onClick={() => setCreating(true)}>Create a product</Button>} />
      <div className="filters" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.value || 'all'}
            type="button"
            className="filters__option"
            aria-pressed={status === f.value}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (f.value) next.set('status', f.value);
              else next.delete('status');
              next.delete('new');
              setParams(next, { replace: true });
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      {state.kind === 'loading' ? <Skeleton label="Loading products" lines={3} /> : null}
      {state.kind === 'failed' ? <ErrorNotice title="Products did not load" error={state.error} onRetry={reload} /> : null}
      {state.kind === 'ready' ? <p className="visually-hidden" role="status">{products.length} products</p> : null}
      {state.kind === 'ready' && products.length === 0 ? (
        <EmptyState title={status ? 'No products with this status' : 'Publish your first product'} action={!status ? <Button onClick={() => setCreating(true)}>Create a product</Button> : undefined}>
          <p>{status ? 'Choose another filter to see the rest.' : 'Start with a title and type. You can add the curriculum, files and price before you publish.'}</p>
        </EmptyState>
      ) : null}
      {products.length > 0 ? (
        <div className="table-scroll" role="region" aria-label="Products" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Status</th>
                <th scope="col" className="data-table__num">Price</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="data-table__cell">
                      <span className={`table-cover table-cover--${p.productType}`} aria-hidden="true" />
                      <span className="data-table__primary">
                        <Link to={`/studio/products/${p.id}`}>{p.title}</Link>
                        <span className="data-table__secondary">{p.productType === 'course' ? 'Course' : 'Download'}, /{p.slug}</span>
                      </span>
                    </span>
                  </td>
                  <td><ProductStatusBadge status={p.status} /></td>
                  <td className="data-table__num tabular">{p.price.currency ? (p.price.amountMinor === 0 ? 'Free' : formatMoney(p.price)) : '—'}</td>
                  <td>{formatDate(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <CreateProductDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateProductDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [type, setType] = useState<'course' | 'download'>('course');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [local, setLocal] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setTitle('');
      setSlug('');
      setSlugTouched(false);
      setType('course');
      setError(null);
      setLocal({});
    }
  }, [open]);

  const issues = { ...issuesByPath(error), ...local };
  const needsCurrency = isApiError(error) && error.code === 'conflict' && error.issues.some((i) => i.path === 'currency');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextLocal: Record<string, string> = {};
    if (!title.trim()) nextLocal.title = 'Enter a title.';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3) nextLocal.slug = 'Use at least 3 lowercase letters, numbers and single hyphens.';
    setLocal(nextLocal);
    if (Object.keys(nextLocal).length) return;
    setBusy(true);
    setError(null);
    try {
      const { product } = await api<{ product: OwnerProduct }>('/api/owner/products', { method: 'POST', body: { title: title.trim(), slug, productType: type } });
      onClose();
      navigate(`/studio/products/${product.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Create a product" closeLabel="Cancel creating a product">
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Title" value={title} maxLength={160} error={issues.title} onChange={(e) => {
          setTitle(e.target.value);
          if (!slugTouched) setSlug(slugify(e.target.value));
        }} />
        <Field label="Web address" description={`Shown as /products/${slug || 'your-product'}. Lowercase letters, numbers and hyphens.`} value={slug} maxLength={80} error={issues.slug} spellCheck={false} onChange={(e) => {
          setSlugTouched(true);
          setSlug(e.target.value.toLowerCase());
        }} />
        <RadioGroup legend="Type" name="productType" value={type} onChange={setType} options={[
          { value: 'course', label: 'Course', description: 'Sections and lessons with video or text.' },
          { value: 'download', label: 'Download', description: 'Files the buyer downloads, such as a PDF or ZIP.' },
        ]} />
        {needsCurrency ? (
          <Notice tone="danger" title="Choose the shop currency first" actions={<Link className="button button--secondary" to="/studio/settings">Open settings</Link>}>
            <p>Prices are stored in the shop currency, so set it before adding products.</p>
          </Notice>
        ) : error && !Object.keys(issuesByPath(error)).length ? <ErrorNotice title="The product was not created" error={error} /> : null}
        <div className="form-actions">
          <Button type="submit" busy={busy} busyLabel="Creating…">Create draft</Button>
        </div>
      </form>
    </Dialog>
  );
}
