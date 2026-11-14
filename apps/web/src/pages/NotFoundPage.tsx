import { LinkButton } from '../components/Button';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useNoIndex } from '../lib/useNoIndex';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  useNoIndex(true);
  return (
    <section className="page-message wrap" aria-labelledby="not-found-title">
      <h1 id="not-found-title" className="page-message__title">
        We could not find that page
      </h1>
      <p className="page-message__body">The link may be old, or the address may have a typo.</p>
      <div className="page-message__actions">
        <LinkButton to="/">Go to the shop</LinkButton>
        <LinkButton to="/library" variant="secondary">
          Open my learning
        </LinkButton>
      </div>
    </section>
  );
}
