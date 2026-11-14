import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useShop } from '../lib/shop';
import { ShopName } from './ShopName';
import { SkipLink } from './SkipLink';
import { useFocusMainOnNavigate } from './useFocusMainOnNavigate';

export function PublicShell() {
  const { pathname } = useLocation();
  const { shop } = useShop();
  useFocusMainOnNavigate();
  const legal = shop?.legal;
  const creator = shop?.creator?.name?.trim();

  return (
    <div className="shell shell--public">
      <SkipLink />
      <header className="site-header wrap">
        <Link to="/" className="site-header__brand">
          <BrandMark />
          <ShopName />
        </Link>
        <nav className="site-nav" aria-label="Main">
          <NavLink to="/" end className="site-nav__link">
            Shop
          </NavLink>
          <NavLink to="/library" className="site-nav__link">
            My learning
          </NavLink>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="site-main">
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <footer className="site-footer">
        <div className="wrap site-footer__inner">
          <div className="site-footer__identity">
            <p className="site-footer__shop">
              <ShopName />
            </p>
            {creator ? <p>By {creator}</p> : null}
          </div>
          <nav className="site-footer__links" aria-label="Shop information">
            <Link to="/help">Help</Link>
            {legal?.terms ? <a href={legal.terms}>Terms</a> : null}
            {legal?.privacy ? <a href={legal.privacy}>Privacy</a> : null}
            {legal?.refund ? <a href={legal.refund}>Refunds</a> : null}
          </nav>
          <p className="site-footer__credit">Runs on Pagelet</p>
        </div>
      </footer>
    </div>
  );
}
