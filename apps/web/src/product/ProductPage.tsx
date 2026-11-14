import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { LibraryItem } from '@pagelet/contracts';
import { Badge } from '../components/Badge';
import { LinkButton } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { Notice } from '../components/Notice';
import { ProductCover, lessonCount, productKindLabel } from '../components/ProductCover';
import { Skeleton } from '../components/Skeleton';
import { api, isApiError } from '../lib/api';
import { isSlug } from '../lib/patterns';
import { useShop } from '../lib/shop';
import type { PublicProduct } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useNoIndex } from '../lib/useNoIndex';
import { PurchasePanel, type Ownership } from './PurchasePanel';
import './product.css';

type ProductState =
  | { kind: 'loading' }
  | { kind: 'ready'; product: PublicProduct }
  | { kind: 'missing' }
  | { kind: 'failed'; error: unknown };

/** Public product detail. Lazy-loaded route at /products/:slug (Stripe's cancel URL points here). */
export default function ProductPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const cancelled = params.get('checkout') === 'cancelled';
  const { shop } = useShop();
  const [state, setState] = useState<ProductState>(isSlug(slug) ? { kind: 'loading' } : { kind: 'missing' });
  const [ownership, setOwnership] = useState<Ownership>('unknown');
  const [attempt, setAttempt] = useState(0);

  useNoIndex(state.kind === 'missing');
  useDocumentTitle(state.kind === 'ready' ? state.product.title : state.kind === 'missing' ? 'Product not found' : '');

  useEffect(() => {
    if (!isSlug(slug)) {
      setState({ kind: 'missing' });
      return;
    }
    const controller = new AbortController();
    setState({ kind: 'loading' });
    api<PublicProduct>(`/api/catalog/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then((product) => setState({ kind: 'ready', product }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(isApiError(error) && error.status === 404 ? { kind: 'missing' } : { kind: 'failed', error });
      });
    return () => controller.abort();
  }, [slug, attempt]);

  // Known-purchase behaviour: if the visitor is signed in and owns this product, offer "Open" instead of "Buy".
  useEffect(() => {
    if (!isSlug(slug)) return;
    const controller = new AbortController();
    api<{ items: LibraryItem[] }>('/api/library', { signal: controller.signal })
      .then((body) => {
        const item = body?.items?.find((i) => i.slug === slug);
        setOwnership(item ? item.status : 'none');
      })
      .catch(() => {
        if (!controller.signal.aborted) setOwnership('none');
      });
    return () => controller.abort();
  }, [slug]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state.kind === 'loading') {
    return (
      <div className="wrap product-page">
        <Skeleton label="Loading product" lines={4} />
      </div>
    );
  }

  if (state.kind === 'missing') {
    return (
      <section className="page-message wrap" aria-labelledby="missing-title">
        <h1 id="missing-title" className="page-message__title">
          This product is not available
        </h1>
        <p className="page-message__body">It may have been renamed or taken out of the shop. You can still open anything you bought from My learning.</p>
        <div className="page-message__actions">
          <LinkButton to="/">Browse the shop</LinkButton>
          <LinkButton to="/library" variant="secondary">
            Open my learning
          </LinkButton>
        </div>
      </section>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="wrap product-page">
        <h1 className="page-message__title">Product</h1>
        <ErrorNotice title="This product did not load" error={state.error} onRetry={retry} />
      </div>
    );
  }

  const { product } = state;
  const isCourse = product.productType === 'course';
  const paragraphs = product.description.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const totalLessons = lessonCount(product);
  const creatorName = shop?.creator?.name?.trim();
  const creatorBio = shop?.creator?.bio?.trim();
  const refund = shop?.legal?.refund;
  const terms = shop?.legal?.terms;

  return (
    <article className="wrap product-page" aria-labelledby="product-title">
      {cancelled ? (
        <Notice tone="info" title="Checkout cancelled" className="product-page__notice">
          <p>You left the checkout before paying, so nothing was charged. You can try again whenever you like.</p>
        </Notice>
      ) : null}

      <div className="product-hero">
        <div className="product-hero__cover">
          <ProductCover product={product} size="detail" />
        </div>
        <div className="product-hero__body">
          <p className="product-hero__kind">{productKindLabel(product)}</p>
          <h1 id="product-title" className="product-hero__title">
            {product.title}
          </h1>
          {creatorName ? <p className="product-hero__creator">By {creatorName}</p> : null}
          {paragraphs.length > 0 ? (
            <div className="product-hero__description prose">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          ) : null}
          <PurchasePanel product={product} ownership={ownership} taxMode={shop?.taxMode} />
        </div>
      </div>

      <div className="product-details">
        {product.outcomes.length > 0 ? (
          <section className="product-section" aria-labelledby="outcomes-title">
            <h2 id="outcomes-title" className="product-section__title">
              {isCourse ? 'What you will be able to do' : 'What this helps you do'}
            </h2>
            <ul className="outcomes">
              {product.outcomes.map((outcome, i) => (
                <li key={i}>{outcome}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {product.sections.length > 0 ? (
          <section className="product-section" aria-labelledby="outline-title">
            <h2 id="outline-title" className="product-section__title">
              {isCourse ? 'Course outline' : 'What is included'}
            </h2>
            {isCourse && totalLessons > 0 ? (
              <p className="product-section__lead">
                {product.sections.length} {product.sections.length === 1 ? 'section' : 'sections'}, {totalLessons}{' '}
                {totalLessons === 1 ? 'lesson' : 'lessons'}. Lessons open after purchase.
              </p>
            ) : null}
            <ol className="outline">
              {product.sections.map((section, sIndex) => (
                <li key={sIndex} className="outline__section">
                  <h3 className="outline__section-title">{section.title}</h3>
                  {section.lessons.length > 0 ? (
                    <ol className="outline__lessons">
                      {section.lessons.map((lesson, lIndex) => (
                        <li key={lIndex} className="outline__lesson">
                          <span className="outline__lesson-title">{lesson.title}</span>
                          <span className="outline__lesson-meta">
                            {lesson.kind === 'video' ? 'Video' : 'Reading'}
                            {lesson.preview ? <Badge tone="info">Preview lesson</Badge> : null}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {creatorName || creatorBio ? (
          <section className="product-section" aria-labelledby="creator-title">
            <h2 id="creator-title" className="product-section__title">
              About the creator
            </h2>
            {creatorName ? <p className="product-section__name">{creatorName}</p> : null}
            {creatorBio ? <p className="product-section__lead prose">{creatorBio}</p> : null}
          </section>
        ) : null}

        {refund || terms ? (
          <section className="product-section" aria-labelledby="policies-title">
            <h2 id="policies-title" className="product-section__title">
              Refunds and terms
            </h2>
            <ul className="link-list">
              {refund ? <li><a href={refund}>Read the refund policy</a></li> : null}
              {terms ? <li><a href={terms}>Read the terms of sale</a></li> : null}
            </ul>
          </section>
        ) : null}
      </div>
    </article>
  );
}
