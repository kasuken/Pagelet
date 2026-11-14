import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { LinkButton } from '../components/Button';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ErrorNotice } from '../components/ErrorNotice';
import { Notice } from '../components/Notice';
import { Skeleton } from '../components/Skeleton';
import { api, isApiError } from '../lib/api';
import { ownerLoginPath } from '../lib/ownerLogin';
import { ShopName } from '../shells/ShopName';
import { SkipLink } from '../shells/SkipLink';
import { useFocusMainOnNavigate } from '../shells/useFocusMainOnNavigate';
import { OverviewPage } from './OverviewPage';
import { ProductsPage } from './products/ProductsPage';
import { ProductWorkspace } from './products/ProductWorkspace';
import { PreviewPage } from './products/PreviewPage';
import { SettingsPage } from './SettingsPage';
import { CustomerDetailPage, CustomersPage } from './support/CustomersPage';
import { DataPage } from './support/DataPage';
import { MessagesPage } from './support/MessagesPage';
import { OrderDetailPage, OrdersPage } from './support/OrdersPage';
import { PaymentsPage } from './support/PaymentsPage';
import { StudioNotFound } from './StudioNotFound';

const NAV: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/studio', label: 'Overview', end: true },
  { to: '/studio/products', label: 'Products' },
  { to: '/studio/orders', label: 'Orders' },
  { to: '/studio/customers', label: 'Customers' },
  { to: '/studio/emails', label: 'Emails' },
  { to: '/studio/payments', label: 'Payment events' },
  { to: '/studio/settings', label: 'Settings' },
  { to: '/studio/data', label: 'Audit and data' },
];
import './studio.css';

type OwnerState =
  | { kind: 'checking' }
  | { kind: 'owner'; provider: string }
  | { kind: 'denied'; status: 401 | 403 | 503; requestId: string }
  | { kind: 'failed'; error: unknown };

/** Owner Studio. Lazy-loaded; the API decides who the owner is via GET /api/owner/me. */
export default function StudioApp() {
  const { pathname } = useLocation();
  useFocusMainOnNavigate();
  const [state, setState] = useState<OwnerState>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'checking' });
    api<{ owner: { provider: string } }>('/api/owner/me', { signal: controller.signal })
      .then((body) => setState({ kind: 'owner', provider: body.owner.provider }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isApiError(error) && (error.status === 401 || error.status === 403 || error.status === 503)) {
          setState({ kind: 'denied', status: error.status, requestId: error.requestId });
          return;
        }
        setState({ kind: 'failed', error });
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const isOwner = state.kind === 'owner';

  return (
    <div className="shell shell--studio">
      <SkipLink />
      <header className="studio-header">
        <Link to="/studio" className="studio-header__brand">
          <BrandMark />
          <span>
            <ShopName />
            <span className="studio-header__context">Studio</span>
          </span>
        </Link>
        <a className="studio-header__exit" href="/">
          View shop
        </a>
      </header>
      <div className={isOwner ? 'studio-frame' : 'studio-frame studio-frame--locked'}>
        {isOwner ? (
          <nav className="studio-nav" aria-label="Studio">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="studio-nav__link">
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
        <main id="main" tabIndex={-1} className="studio-main">
          <ErrorBoundary resetKey={pathname}>
            {state.kind === 'checking' ? <Skeleton label="Checking studio access" lines={3} /> : null}
            {state.kind === 'denied' ? <AccessMessage status={state.status} requestId={state.requestId} /> : null}
            {state.kind === 'failed' ? (
              <section aria-labelledby="studio-failed-title">
                <h1 id="studio-failed-title" className="studio-title">
                  Studio
                </h1>
                <ErrorNotice title="We could not check studio access" error={state.error} onRetry={retry} />
              </section>
            ) : null}
            {state.kind === 'owner' ? (
              <Routes>
                <Route index element={<OverviewPage provider={state.provider} />} />
                <Route path="products" element={<ProductsPage />} />
                <Route path="products/:id" element={<ProductWorkspace />} />
                <Route path="products/:id/preview" element={<PreviewPage />} />
                <Route path="orders" element={<OrdersPage />} />
                <Route path="orders/:id" element={<OrderDetailPage />} />
                <Route path="customers" element={<CustomersPage />} />
                <Route path="customers/:id" element={<CustomerDetailPage />} />
                <Route path="emails" element={<MessagesPage />} />
                <Route path="payments" element={<PaymentsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="data" element={<DataPage />} />
                <Route path="*" element={<StudioNotFound />} />
              </Routes>
            ) : null}
          </ErrorBoundary>
        </main>
      </div>
      <footer className="studio-footer">
        <p>One owner, one shop. Signed-in studio sessions are managed by your hosting provider.</p>
      </footer>
    </div>
  );
}

function AccessMessage({ status, requestId }: { status: 401 | 403 | 503; requestId: string }) {
  const loginPath = ownerLoginPath();
  const copy = {
    401: {
      title: 'Sign in to open the studio',
      body: loginPath
        ? 'The studio is for the shop owner. Sign in with the owner account you configured for this shop.'
        : 'The studio is for the shop owner. No owner sign-in path is configured in this build: set VITE_OWNER_LOGIN_PATH (for example /.auth/login/github) and rebuild.',
      action: loginPath ? (
        <a className="button button--primary" href={loginPath}>
          Sign in as the owner
        </a>
      ) : null,
    },
    403: {
      title: 'This account is not the shop owner',
      body: 'You are signed in, but not with the account configured as this shop’s owner. Sign out and sign in with the owner account.',
      action: (
        <a className="button button--primary" href="/.auth/logout?post_logout_redirect_uri=/studio">
          Sign out and switch account
        </a>
      ),
    },
    503: {
      title: 'The shop owner is not set up yet',
      body: 'Set OWNER_IDENTITY_PROVIDER and OWNER_USER_ID in the Static Web App settings, then reload this page. Until then the studio stays locked for everyone.',
      action: <LinkButton to="/">Go to the shop</LinkButton>,
    },
  }[status];

  return (
    <section aria-labelledby="studio-access-title" className="studio-access">
      <h1 id="studio-access-title" className="studio-title">
        {copy.title}
      </h1>
      <Notice tone={status === 503 ? 'info' : 'danger'} requestId={requestId} actions={copy.action}>
        <p>{copy.body}</p>
      </Notice>
    </section>
  );
}
