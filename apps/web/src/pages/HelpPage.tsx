import { LinkButton } from '../components/Button';
import { Skeleton } from '../components/Skeleton';
import { useShop } from '../lib/shop';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function HelpPage() {
  useDocumentTitle('Help');
  const state = useShop();
  const links = state.shop?.contactLinks ?? [];
  const legal = state.shop?.legal;

  return (
    <section className="page-message wrap" aria-labelledby="help-title">
      <h1 id="help-title" className="page-message__title">
        Help
      </h1>
      <div className="help-grid">
        <div>
          <h2 className="help-grid__title">Opening your purchases</h2>
          <p className="page-message__body">
            Sign in with the email address you used at checkout. We send a one-time link; there is no password.
          </p>
          <div className="page-message__actions">
            <LinkButton to="/account/sign-in" variant="secondary">
              Email me a sign-in link
            </LinkButton>
          </div>
        </div>
        <div>
          <h2 className="help-grid__title">Contact the shop</h2>
          {state.status === 'loading' ? <Skeleton label="Loading contact details" lines={2} /> : null}
          {state.status !== 'loading' && links.length === 0 ? (
            <p className="page-message__body">This shop has not added contact details yet.</p>
          ) : null}
          {links.length > 0 ? (
            <ul className="link-list">
              {links.map((link) => (
                <li key={`${link.label}-${link.url}`}>
                  <a href={link.url} rel="noopener noreferrer">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {legal && (legal.terms || legal.privacy || legal.refund) ? (
            <>
              <h2 className="help-grid__title">Policies</h2>
              <ul className="link-list">
                {legal.terms ? <li><a href={legal.terms}>Terms</a></li> : null}
                {legal.privacy ? <li><a href={legal.privacy}>Privacy notice</a></li> : null}
                {legal.refund ? <li><a href={legal.refund}>Refund policy</a></li> : null}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
