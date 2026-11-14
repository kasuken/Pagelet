import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LinkButton } from '../../components/Button';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Notice } from '../../components/Notice';
import { Skeleton } from '../../components/Skeleton';
import { Tabs } from '../../components/Tabs';
import { isApiError } from '../../lib/api';
import type { OwnerProductDetail } from '../../lib/types';
import { useApiResource } from '../../lib/useApi';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { ProductStatusBadge, StudioHeading, useUnsavedWarning } from '../common';
import { CurriculumTab } from './CurriculumTab';
import { DetailsTab } from './DetailsTab';
import { FilesTab } from './FilesTab';
import { PricingTab } from './PricingTab';
import { PublishPanel } from './PublishPanel';

type Tab = 'details' | 'content' | 'pricing';

/** O01 product workspace: Details, Curriculum or Files, Pricing; Preview and Publish are separate actions. */
export function ProductWorkspace() {
  const { id = '' } = useParams();
  const { state, reload, set } = useApiResource<{ product: OwnerProductDetail }>(`/api/owner/products/${encodeURIComponent(id)}`);
  const [tab, setTab] = useState<Tab>('details');
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  useUnsavedWarning(Object.values(dirty).some(Boolean));
  useDocumentTitle(state.kind === 'ready' ? state.data.product.title : 'Product');

  const markDirty = useCallback((key: string, value: boolean) => setDirty((d) => (d[key] === value ? d : { ...d, [key]: value })), []);
  const replace = useCallback((product: OwnerProductDetail) => set({ product }), [set]);

  if (state.kind === 'loading') return <Skeleton label="Loading the product" lines={4} />;
  if (state.kind === 'failed') {
    if (isApiError(state.error) && state.error.status === 404) {
      return (
        <>
          <StudioHeading title="Product not found" back={<Link to="/studio/products">All products</Link>} />
          <Notice tone="info"><p>It may have been deleted. Go back to the product list.</p></Notice>
        </>
      );
    }
    return (
      <>
        <StudioHeading title="Product" back={<Link to="/studio/products">All products</Link>} />
        <ErrorNotice title="The product did not load" error={state.error} onRetry={reload} />
      </>
    );
  }

  const product = state.data.product;
  const archived = product.status === 'archived';
  const tabs: Array<{ value: Tab; label: string }> = [
    { value: 'details', label: 'Details' },
    { value: 'content', label: product.productType === 'course' ? 'Curriculum' : 'Files' },
    { value: 'pricing', label: 'Pricing' },
  ];
  const reloadLatest = () => {
    setDirty({});
    reload();
  };

  return (
    <>
      <StudioHeading
        title={product.title}
        back={<Link to="/studio/products">All products</Link>}
        lead={
          <span className="workspace__meta">
            <ProductStatusBadge status={product.status} />
            <span>{product.productType === 'course' ? 'Course' : 'Download'}</span>
            <span>Revision {product.revision}{product.publishedVersion ? `, live version ${product.publishedVersion}` : ', not published yet'}</span>
          </span>
        }
        action={<LinkButton to={`/studio/products/${product.id}/preview`} variant="secondary">Preview</LinkButton>}
      />
      {archived ? <Notice tone="info" title="Archived products are read-only"><p>This product is no longer sold. Buyers keep their access.</p></Notice> : null}
      <PublishPanel product={product} onChanged={reload} unsaved={Object.values(dirty).some(Boolean)} />
      <Tabs label="Product editor" tabs={tabs} value={tab} onChange={setTab}>
        <div hidden={tab !== 'details'}>
          <DetailsTab product={product} readOnly={archived} onSaved={replace} onReload={reloadLatest} onDirty={(v) => markDirty('details', v)} />
        </div>
        <div hidden={tab !== 'content'}>
          {product.productType === 'course' ? (
            <CurriculumTab product={product} readOnly={archived} onChanged={reload} onDirty={(v) => markDirty('content', v)} />
          ) : (
            <FilesTab product={product} readOnly={archived} onChanged={reload} />
          )}
        </div>
        <div hidden={tab !== 'pricing'}>
          <PricingTab product={product} readOnly={archived} onSaved={replace} onReload={reloadLatest} onDirty={(v) => markDirty('pricing', v)} />
        </div>
      </Tabs>
    </>
  );
}
