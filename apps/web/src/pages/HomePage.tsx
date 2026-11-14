import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, LinkButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { ErrorNotice } from '../components/ErrorNotice';
import { ProductCover, productKindLabel } from '../components/ProductCover';
import { Skeleton } from '../components/Skeleton';
import { api } from '../lib/api';
import { formatMoney, isFree } from '../lib/money';
import { useShop } from '../lib/shop';
import type { PublicProduct } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type CatalogState = { kind: 'loading' } | { kind: 'ready'; items: PublicProduct[] } | { kind: 'failed'; error: unknown };
type Filter = 'all' | 'course' | 'download';

const FILTERS: Array<{ value: Filter; label: string; noun: [string, string] }> = [
  { value: 'all', label: 'Everything', noun: ['product', 'products'] },
  { value: 'course', label: 'Courses', noun: ['course', 'courses'] },
  { value: 'download', label: 'Downloads', noun: ['download', 'downloads'] },
];

function parseFilter(value: string | null): Filter {
  return value === 'course' || value === 'download' ? value : 'all';
}

export function priceLabel(product: PublicProduct): string {
  return isFree(product.price) ? 'Free' : formatMoney(product.price);
}

export function HomePage() {
  useDocumentTitle('');
  const shopState = useShop();
  const shop = shopState.shop;
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params.get('type'));
  const [catalog, setCatalog] = useState<CatalogState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog({ kind: 'loading' });
    api<{ items: PublicProduct[] }>('/api/catalog', { signal: controller.signal })
      .then((body) => setCatalog({ kind: 'ready', items: Array.isArray(body?.items) ? body.items : [] }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setCatalog({ kind: 'failed', error });
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const items = catalog.kind === 'ready' ? catalog.items : [];
  // The owner's featured product when it is published; otherwise the first course.
  const featuredSlug = shop?.featuredSlug ?? null;
  const featured = useMemo(
    () => items.find((p) => p.slug === featuredSlug) ?? items.find((p) => p.productType === 'course') ?? items[0] ?? null,
    [items, featuredSlug],
  );
  const visible = filter === 'all' ? items : items.filter((p) => p.productType === filter);
  const activeFilter = FILTERS.find((f) => f.value === filter) ?? FILTERS[0]!;
  const hasBothTypes = items.some((p) => p.productType === 'course') && items.some((p) => p.productType === 'download');

  function chooseFilter(value: Filter) {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('type');
    else next.set('type', value);
    setParams(next, { replace: true, preventScrollReset: true });
  }

  const creator = shop?.creator?.name?.trim();
  const introduction = shop?.introduction?.trim();

  return (
    <>
      <section className="shop-intro wrap" aria-labelledby="shop-title">
        <div className="shop-intro__copy">
          {creator ? <p className="shop-intro__kicker">By {creator}</p> : null}
          <h1 id="shop-title" className={shop ? 'shop-intro__title' : 'shop-intro__title shop-intro__title--pending'}>
            {shop?.shopName?.trim() || (shopState.status === 'loading' ? <span className="visually-hidden">Shop</span> : 'Shop')}
          </h1>
          {introduction ? <p className="shop-intro__lead">{introduction}</p> : null}
          <div className="shop-intro__actions">
            {featured ? (
              <LinkButton to={`/products/${featured.slug}`}>See {featured.productType === 'course' ? 'the course' : 'the download'}</LinkButton>
            ) : null}
            <a className="button button--secondary" href="#collection-title">
              Browse the collection
            </a>
          </div>
        </div>
        {featured ? (
          <Link to={`/products/${featured.slug}`} className="feature-link">
            <ProductCover product={featured} size="feature" />
            <span className="visually-hidden">{featured.title}</span>
          </Link>
        ) : (
          <div className="shelf" aria-hidden="true">
            <span className="shelf__cover shelf__cover--course"><span className="shelf__rule" /><span className="shelf__rule shelf__rule--short" /></span>
            <span className="shelf__cover shelf__cover--download"><span className="shelf__rule" /><span className="shelf__rule shelf__rule--short" /></span>
            <span className="shelf__cover shelf__cover--blank"><span className="shelf__rule" /><span className="shelf__rule shelf__rule--short" /></span>
            <span className="shelf__board" />
          </div>
        )}
      </section>

      <section className="collection wrap" aria-labelledby="collection-title" id="collection">
        <div className="collection__heading">
          <h2 id="collection-title" className="collection__title" tabIndex={-1}>
            {activeFilter.value === 'all' ? 'All products' : activeFilter.label}
          </h2>
          {catalog.kind === 'ready' ? (
            <p className="collection__count" role="status">
              {visible.length} {visible.length === 1 ? activeFilter.noun[0] : activeFilter.noun[1]}
            </p>
          ) : null}
        </div>

        {catalog.kind === 'ready' && hasBothTypes ? (
          <div className="filters" role="group" aria-label="Filter products">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className="filters__option"
                aria-pressed={filter === f.value}
                onClick={() => chooseFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : null}

        {catalog.kind === 'loading' ? <Skeleton label="Loading products" lines={3} /> : null}
        {catalog.kind === 'failed' ? <ErrorNotice title="The collection did not load" error={catalog.error} onRetry={retry} /> : null}

        {catalog.kind === 'ready' && items.length === 0 ? (
          <EmptyState title="Nothing published yet" headingLevel={3}>
            <p>New courses and downloads appear here as soon as the shop publishes them.</p>
          </EmptyState>
        ) : null}

        {catalog.kind === 'ready' && items.length > 0 && visible.length === 0 ? (
          <EmptyState
            title={`No ${activeFilter.noun[1]} yet`}
            headingLevel={3}
            action={<Button variant="secondary" onClick={() => chooseFilter('all')}>Show everything</Button>}
          >
            <p>Try another filter to see the rest of the collection.</p>
          </EmptyState>
        ) : null}

        {visible.length > 0 ? (
          <ul className="product-grid">
            {visible.map((product) => (
              <li key={product.slug} className="product-card">
                <Link to={`/products/${product.slug}`} className="product-card__cover" tabIndex={-1} aria-hidden="true">
                  <ProductCover product={product} />
                </Link>
                <p className="product-card__meta">
                  <span>{productKindLabel(product)}</span>
                  <span className="product-card__price tabular">{priceLabel(product)}</span>
                </p>
                <h3 className="product-card__title">
                  <Link to={`/products/${product.slug}`}>{product.title}</Link>
                </h3>
                {product.description ? <p className="product-card__summary">{firstSentence(product.description)}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}

function firstSentence(text: string): string {
  const trimmed = text.trim().split(/\n\s*\n/)[0] ?? '';
  return trimmed.length > 160 ? `${trimmed.slice(0, 157).trimEnd()}…` : trimmed;
}
