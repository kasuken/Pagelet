import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, LinkButton } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { Notice } from '../components/Notice';
import { Surface } from '../components/Surface';
import { api, isApiError } from '../lib/api';
import { recallCheckoutSlug } from '../lib/checkoutKey';
import { CHECKOUT_SESSION_ID, isSlug } from '../lib/patterns';
import { pollDelay } from '../lib/polling';
import { useShop } from '../lib/shop';
import type { CheckoutStatus } from '../lib/types';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type View =
  | { kind: 'checking' }
  | { kind: 'status'; status: CheckoutStatus }
  | { kind: 'timed-out' }
  | { kind: 'unknown' }
  | { kind: 'failed'; error: unknown };

const SIGN_IN_TO_LIBRARY = `/account/sign-in?returnTo=${encodeURIComponent('/library')}`;

/**
 * Stripe success URL: /checkout/return?session_id=cs_…
 * Observes payment state only. Access is granted by the signed webhook, never by this page.
 */
export default function CheckoutReturnPage() {
  useDocumentTitle('Your order');
  const [params] = useSearchParams();
  const raw = params.get('session_id') ?? '';
  const sessionId = CHECKOUT_SESSION_ID.test(raw) ? raw : null;
  const [slug] = useState(() => {
    const saved = recallCheckoutSlug();
    return isSlug(saved) ? saved : null;
  });
  const { shop } = useShop();
  const [view, setView] = useState<View>(sessionId ? { kind: 'checking' } : { kind: 'unknown' });
  const [run, setRun] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let attempt = 0;
    let waitingForVisibility = false;

    const check = async () => {
      if (document.visibilityState === 'hidden') {
        waitingForVisibility = true;
        return;
      }
      try {
        const body = await api<{ status: CheckoutStatus }>(
          `/api/checkout/status?sessionId=${encodeURIComponent(sessionId)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (body.status !== 'pending') {
          setView({ kind: 'status', status: body.status });
          return;
        }
        setView({ kind: 'status', status: 'pending' });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isApiError(error) && error.status === 404) {
          setView({ kind: 'unknown' });
          return;
        }
        if (isApiError(error) && (error.status === 400 || error.status === 429)) {
          setView({ kind: 'failed', error });
          return;
        }
        // Network or server hiccup: keep trying within the same budget.
      }
      const delay = pollDelay(attempt++);
      if (delay === null) {
        setView({ kind: 'timed-out' });
        return;
      }
      timer = window.setTimeout(check, delay);
    };

    const onVisible = () => {
      if (waitingForVisibility && document.visibilityState === 'visible') {
        waitingForVisibility = false;
        void check();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    setView({ kind: 'checking' });
    void check();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sessionId, run]);

  const final = view.kind === 'status' && view.status !== 'pending';
  useEffect(() => {
    if (final || view.kind === 'timed-out') headingRef.current?.focus();
  }, [final, view.kind]);

  const checkAgain = useCallback(() => setRun((n) => n + 1), []);
  const productLink = slug ? (
    <LinkButton to={`/products/${slug}`} variant="secondary">
      Back to the product
    </LinkButton>
  ) : (
    <LinkButton to="/" variant="secondary">
      Back to the shop
    </LinkButton>
  );

  let title = 'Checking your payment';
  let content: ReactNode;

  if (view.kind === 'checking' || (view.kind === 'status' && view.status === 'pending')) {
    title = 'Your payment is processing';
    content = (
      <Notice tone="info" title="This usually takes a few seconds">
        <p>
          Keep this page open and it updates by itself. You can also close it: once the payment is confirmed we email
          you an access link, and the purchase appears in My learning.
        </p>
      </Notice>
    );
  } else if (view.kind === 'status' && view.status === 'paid') {
    title = 'Payment received';
    content = (
      <Notice
        tone="success"
        title="Thank you for your order"
        actions={
          <>
            <LinkButton to={SIGN_IN_TO_LIBRARY}>Sign in to open it</LinkButton>
            {productLink}
          </>
        }
      >
        <p>
          We have emailed your receipt and access link to the address you used at checkout. To open your purchase on
          this device, sign in with that same email address.
        </p>
      </Notice>
    );
  } else if (view.kind === 'status' && view.status === 'failed') {
    title = 'The payment did not go through';
    content = (
      <Notice tone="danger" title="Nothing was charged" live="assertive" actions={productLink}>
        <p>Your bank or card provider declined the payment, or it could not be completed. You can try again from the product page.</p>
      </Notice>
    );
  } else if (view.kind === 'status' && view.status === 'expired') {
    title = 'This checkout expired';
    content = (
      <Notice tone="danger" title="Nothing was charged" live="assertive" actions={productLink}>
        <p>Checkout pages close after a while for your security. Start again from the product page.</p>
      </Notice>
    );
  } else if (view.kind === 'timed-out') {
    title = 'Your payment is still processing';
    content = (
      <Notice
        tone="info"
        title="Confirmation is taking longer than usual"
        actions={
          <>
            <Button onClick={checkAgain}>Check again</Button>
            <LinkButton to={SIGN_IN_TO_LIBRARY} variant="secondary">
              Sign in to My learning
            </LinkButton>
          </>
        }
      >
        <p>
          You do not need to pay again. When the payment is confirmed you will get an email with your access link,
          and the purchase will appear in My learning.
        </p>
      </Notice>
    );
  } else if (view.kind === 'unknown') {
    title = 'We could not find this checkout';
    content = (
      <Notice
        tone="info"
        title="Check your email or My learning"
        actions={
          <>
            <LinkButton to={SIGN_IN_TO_LIBRARY}>Sign in to My learning</LinkButton>
            <LinkButton to="/" variant="secondary">
              Back to the shop
            </LinkButton>
          </>
        }
      >
        <p>This link does not match a checkout. If you paid, your access link is in your email, and your purchase appears in My learning after you sign in.</p>
      </Notice>
    );
  } else if (view.kind === 'failed') {
    title = 'We could not check your payment';
    content = <ErrorNotice title="Status check failed" error={view.error} onRetry={checkAgain} />;
  }

  const refund = shop?.legal?.refund;
  const terms = shop?.legal?.terms;

  return (
    <div className="narrow-page wrap">
      <Surface as="section" className="auth-panel" aria-labelledby="checkout-return-title" aria-busy={view.kind === 'checking' || undefined}>
        <h1 id="checkout-return-title" className="auth-panel__title" tabIndex={-1} ref={headingRef}>
          {title}
        </h1>
        <div className="checkout-return__status">
          {content}
        </div>
        {refund || terms ? (
          <p className="auth-panel__hint checkout-return__policies">
            {refund ? <a href={refund}>Refund policy</a> : null}
            {refund && terms ? ' and ' : null}
            {terms ? <a href={terms}>terms of sale</a> : null}
          </p>
        ) : null}
      </Surface>
    </div>
  );
}
