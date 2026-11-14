import { useState } from 'react';
import { LinkButton } from '../components/Button';
import { Notice } from '../components/Notice';
import { TokenActionPage } from '../components/TokenActionPage';
import { api } from '../lib/api';
import { isSlug } from '../lib/patterns';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function ClaimPage() {
  useDocumentTitle('Confirm your free product');
  const [result, setResult] = useState<{ productSlug: string | null; alreadyClaimed: boolean } | null>(null);

  return (
    <TokenActionPage
      title="Confirm your free product"
      intro="Press the button to add this free product to your learning. Only continue if you asked for it."
      actionLabel="Add to my learning"
      busyLabel="Adding…"
      failureTitle="We could not add the product"
      newLinkTo="/"
      newLinkLabel="Go to the shop"
      onConfirm={async (token) => {
        const body = await api<{ productSlug?: unknown; alreadyClaimed?: unknown }>('/api/free-claims/confirm', {
          method: 'POST',
          body: { token },
        });
        setResult({ productSlug: isSlug(body?.productSlug) ? body.productSlug : null, alreadyClaimed: body?.alreadyClaimed === true });
      }}
      done={
        result ? (
          <Notice
            tone="success"
            title={result.alreadyClaimed ? 'You already have this product' : 'Added to your learning'}
            actions={
              <>
                <LinkButton to="/library">Open my learning</LinkButton>
                {result.productSlug ? (
                  <LinkButton to={`/products/${result.productSlug}`} variant="secondary">
                    Back to the product
                  </LinkButton>
                ) : null}
              </>
            }
          >
            <p>Sign in with the same email address to open it. We never ask for a password.</p>
          </Notice>
        ) : undefined
      }
    />
  );
}
