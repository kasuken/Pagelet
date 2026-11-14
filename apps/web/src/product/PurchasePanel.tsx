import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, LinkButton } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { Field } from '../components/Field';
import { Notice } from '../components/Notice';
import { api, isApiError } from '../lib/api';
import { checkoutKey, forgetCheckoutKey, rememberCheckoutSlug, safeCheckoutUrl } from '../lib/checkoutKey';
import { validateEmail } from '../lib/email';
import { formatMoney, isFree } from '../lib/money';
import type { PublicProduct, TaxMode } from '../lib/types';

export type Ownership = 'unknown' | 'none' | 'active' | 'suspended' | 'revoked';

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'redirecting' }
  | { kind: 'claimed' }
  | { kind: 'not-ready'; requestId: string }
  | { kind: 'failed'; error: unknown };

export function taxNote(currency: string, taxMode: TaxMode | undefined): string {
  if (taxMode === 'none') return `Price in ${currency}. No tax is added. You pay on Stripe’s secure checkout page.`;
  if (taxMode === 'stripe_tax_configured')
    return `Price in ${currency} before any tax. If tax applies, Stripe’s secure checkout page calculates it from your billing address and shows the total before you pay.`;
  return `Price in ${currency}. You pay on Stripe’s secure checkout page, which shows the full total before you confirm.`;
}

export function PurchasePanel({ product, ownership, taxMode }: { product: PublicProduct; ownership: Ownership; taxMode?: TaxMode }) {
  const free = isFree(product.price);
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  // Coming back from Stripe with the Back button restores this page from the bfcache: unlock the form.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setStatus({ kind: 'idle' });
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status.kind === 'working' || status.kind === 'redirecting') return;
    const error = validateEmail(email);
    setFieldError(error);
    if (error) {
      inputRef.current?.focus();
      return;
    }
    const address = email.trim();
    setStatus({ kind: 'working' });
    try {
      if (free) {
        await api('/api/free-claims', { method: 'POST', body: { slug: product.slug, email: address } });
        setStatus({ kind: 'claimed' });
        return;
      }
      const result = await api<{ url?: unknown }>('/api/checkout', {
        method: 'POST',
        body: { slug: product.slug, email: address },
        headers: { 'Idempotency-Key': checkoutKey(product.slug, address) },
      });
      const url = safeCheckoutUrl(result?.url);
      if (!url) throw new Error('Checkout returned an unexpected address.');
      rememberCheckoutSlug(product.slug);
      setStatus({ kind: 'redirecting' });
      window.location.assign(url);
    } catch (caught) {
      if (isApiError(caught) && caught.code === 'conflict') {
        if (caught.issues[0]?.message === 'key_reused') {
          // The stored key belongs to another purchase: start fresh next time.
          forgetCheckoutKey(product.slug);
          setStatus({ kind: 'failed', error: caught });
        } else {
          setStatus({ kind: 'not-ready', requestId: caught.requestId });
        }
        return;
      }
      if (isApiError(caught) && caught.code === 'validation_failed' && caught.issues.some((i) => i.path === 'email')) {
        setFieldError('Enter an email address like name@example.com.');
        setStatus({ kind: 'idle' });
        inputRef.current?.focus();
        return;
      }
      setStatus({ kind: 'failed', error: caught });
    }
  }

  const price = free ? 'Free' : formatMoney(product.price);

  return (
    <section className="purchase" aria-labelledby="purchase-title">
      <h2 id="purchase-title" className="visually-hidden">
        {ownership === 'active' ? 'Your access' : free ? 'Get this product' : 'Buy this product'}
      </h2>
      <p className="purchase__price tabular">{price}</p>
      {!free ? <p className="purchase__note">{taxNote(product.price.currency, taxMode)}</p> : null}

      {ownership === 'active' ? (
        <>
          <p className="purchase__note">You already have this {product.productType === 'course' ? 'course' : 'download'}.</p>
          <LinkButton to={`/learn/${product.slug}`}>{product.productType === 'course' ? 'Open the course' : 'Open your files'}</LinkButton>
        </>
      ) : ownership === 'suspended' ? (
        <Notice tone="danger" title="Your access is paused">
          <p>Access to this purchase is paused while a payment question is resolved. Contact the shop if you need help.</p>
        </Notice>
      ) : status.kind === 'claimed' ? (
        <Notice tone="success" title="Check your email" live="assertive">
          <p>If this address can receive it, a confirmation link is on its way. Open it to add the product to your learning.</p>
        </Notice>
      ) : (
        <form className="purchase__form" onSubmit={submit} noValidate>
          <Field
            ref={inputRef}
            label="Your email"
            description={free ? 'We send a link to confirm and open it.' : 'For your receipt and access link. Sign in later with the same address.'}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            required
            value={email}
            error={fieldError}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldError) setFieldError(undefined);
            }}
          />
          <Button
            type="submit"
            busy={status.kind === 'working' || status.kind === 'redirecting'}
            busyLabel={status.kind === 'redirecting' ? 'Opening secure checkout…' : free ? 'Sending link…' : 'Preparing checkout…'}
          >
            {free ? 'Get it free' : `Buy for ${price}`}
          </Button>
          {ownership === 'revoked' ? (
            <p className="purchase__note">Your earlier access to this product has ended. Buying again starts new access.</p>
          ) : null}
        </form>
      )}

      {status.kind === 'not-ready' ? (
        <Notice tone="danger" title="This shop is not taking payments yet" requestId={status.requestId} live="assertive">
          <p>The shop owner still needs to finish the checkout settings. Nothing has been charged. Try again later.</p>
        </Notice>
      ) : null}
      {status.kind === 'failed' ? (
        <ErrorNotice title={free ? 'We could not send the link' : 'Checkout did not start'} error={status.error} />
      ) : null}
    </section>
  );
}
