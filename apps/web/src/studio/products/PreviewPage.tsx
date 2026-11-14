import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/Badge';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Notice } from '../../components/Notice';
import { ProductCover } from '../../components/ProductCover';
import { Skeleton } from '../../components/Skeleton';
import { formatMoney } from '../../lib/money';
import { useShop } from '../../lib/shop';
import type { OwnerPreview, PublicProduct } from '../../lib/types';
import { useApiResource } from '../../lib/useApi';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { StudioHeading } from '../common';
import '../../product/product.css';

/** Owner-only draft preview from GET /api/owner/products/{id}/preview. Never public. */
export function PreviewPage() {
  const { id = '' } = useParams();
  const { shop } = useShop();
  const { state, reload } = useApiResource<OwnerPreview>(`/api/owner/products/${encodeURIComponent(id)}/preview`);
  useDocumentTitle('Preview');
  const back = <Link to={`/studio/products/${id}`}>Back to the editor</Link>;

  if (state.kind === 'loading') return <Skeleton label="Loading the preview" lines={4} />;
  if (state.kind === 'failed') return <><StudioHeading title="Preview" back={back} /><ErrorNotice title="The preview did not load" error={state.error} onRetry={reload} /></>;

  const { product, sections } = state.data;
  const currency = shop?.currency ?? null;
  const asPublic: PublicProduct = {
    slug: product.slug,
    productType: product.type,
    title: product.title,
    description: product.description,
    outcomes: product.outcomes,
    price: { amountMinor: product.priceMinor, currency: currency ?? 'EUR' },
    sections: sections.map((s) => ({ title: s.title, lessons: s.lessons.map((l) => ({ title: l.title, kind: l.kind, preview: l.preview })) })),
  };

  return (
    <>
      <StudioHeading title={`Preview: ${product.title}`} back={back} />
      <Notice tone="info" title="Only you can see this preview" live="off">
        <p>It shows the saved draft (revision {product.revision}). Visitors see {product.publishedVersion ? `version ${product.publishedVersion}` : 'nothing yet'} until you publish.</p>
      </Notice>
      <div className="preview">
        <div className="preview__cover"><ProductCover product={asPublic} size="detail" /></div>
        <div className="preview__body">
          <p className="product-hero__kind">{product.type === 'course' ? 'Course' : 'Download'}</p>
          <h2 className="product-hero__title">{product.title}</h2>
          <p className="purchase__price tabular">{product.priceMinor === 0 ? 'Free' : currency ? formatMoney({ amountMinor: product.priceMinor, currency }) : 'No currency set'}</p>
          {product.description.split(/\n\s*\n/).filter(Boolean).map((p, i) => <p key={i} className="prose">{p}</p>)}
          {product.outcomes.length > 0 ? (
            <>
              <h3 className="product-section__title">Outcomes</h3>
              <ul className="outcomes">{product.outcomes.map((o, i) => <li key={i}>{o}</li>)}</ul>
            </>
          ) : null}
          {sections.length > 0 ? (
            <>
              <h3 className="product-section__title">Outline</h3>
              <ol className="outline">
                {sections.map((s) => (
                  <li key={s.id} className="outline__section">
                    <h4 className="outline__section-title">{s.title}</h4>
                    <ol className="outline__lessons">
                      {s.lessons.map((l) => (
                        <li key={l.id} className="outline__lesson">
                          <span>{l.title}</span>
                          <span className="outline__lesson-meta">{l.kind === 'video' ? 'Video' : 'Reading'}{l.preview ? <Badge tone="info">Preview lesson</Badge> : null}</span>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
