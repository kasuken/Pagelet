import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ShopProvider } from './lib/shop';
import { ClaimPage } from './pages/ClaimPage';
import { ConfirmPage } from './pages/ConfirmPage';
import { HelpPage } from './pages/HelpPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SignInPage } from './pages/SignInPage';
import { PublicShell } from './shells/PublicShell';
import { RouteFallback } from './shells/RouteFallback';

// Route-level code splitting: product, checkout, customer and owner code stay out of the entry chunk.
const ProductPage = lazy(() => import('./product/ProductPage'));
const CheckoutReturnPage = lazy(() => import('./checkout/CheckoutReturnPage'));
const CustomerApp = lazy(() => import('./customer/CustomerApp'));
const LearnApp = lazy(() => import('./learn/LearnApp'));
const StudioApp = lazy(() => import('./studio/StudioApp'));

function Lazy({ label, children }: { label: string; children: ReactNode }) {
  return <Suspense fallback={<RouteFallback label={label} />}>{children}</Suspense>;
}

export function App() {
  return (
    <ErrorBoundary>
      <ShopProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<PublicShell />}>
              <Route index element={<HomePage />} />
              <Route path="products/:slug" element={<Lazy label="Loading product"><ProductPage /></Lazy>} />
              <Route path="checkout/return" element={<Lazy label="Loading your order"><CheckoutReturnPage /></Lazy>} />
              <Route path="account/sign-in" element={<SignInPage />} />
              <Route path="account/confirm" element={<ConfirmPage />} />
              <Route path="account/claim" element={<ClaimPage />} />
              <Route path="library" element={<Lazy label="Loading your learning"><CustomerApp /></Lazy>} />
              <Route path="learn/:slug" element={<Lazy label="Loading your course"><LearnApp /></Lazy>} />
              <Route path="help" element={<HelpPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
            <Route path="studio/*" element={<Lazy label="Loading the studio"><StudioApp /></Lazy>} />
          </Routes>
        </BrowserRouter>
      </ShopProvider>
    </ErrorBoundary>
  );
}
