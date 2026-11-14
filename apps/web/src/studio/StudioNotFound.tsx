import { LinkButton } from '../components/Button';
import { useDocumentTitle } from '../lib/useDocumentTitle';

export function StudioNotFound() {
  useDocumentTitle('Studio page not found');
  return (
    <section aria-labelledby="studio-404-title">
      <h1 id="studio-404-title" className="studio-title">
        This studio page does not exist
      </h1>
      <p className="studio-heading__lead">Check the address, or go back to the overview.</p>
      <div className="page-message__actions">
        <LinkButton to="/studio">Go to the overview</LinkButton>
      </div>
    </section>
  );
}
