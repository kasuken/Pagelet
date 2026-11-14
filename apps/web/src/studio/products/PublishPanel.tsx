import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Notice } from '../../components/Notice';
import { api, isApiError } from '../../lib/api';
import type { OwnerProductDetail, PublicationResult } from '../../lib/types';

type State =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'building'; publication: PublicationResult; since: number }
  | { kind: 'succeeded'; versionNo: number }
  | { kind: 'slow'; publication: PublicationResult }
  | { kind: 'failed'; publication: PublicationResult }
  | { kind: 'error'; error: unknown };

const POLL_MS = 5000;
const SLOW_AFTER_MS = 5 * 60_000;

/**
 * Publish is separate from Preview and from saving. It snapshots the saved draft and starts a static build;
 * the live version changes only when the build succeeds, which we observe through publishedVersion.
 */
export function PublishPanel({ product, onChanged, unsaved = false }: { product: OwnerProductDetail; onChanged: () => void; unsaved?: boolean }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const headingRef = useRef<HTMLParagraphElement>(null);
  const archived = product.status === 'archived';
  const blockers = product.publishReadiness;

  // Watch the product after a publish request until the new version is live.
  useEffect(() => {
    if (state.kind !== 'building') return;
    if ((product.publishedVersion ?? 0) >= state.publication.versionNo) {
      setState({ kind: 'succeeded', versionNo: state.publication.versionNo });
      return;
    }
    const timer = window.setTimeout(() => {
      if (Date.now() - state.since > SLOW_AFTER_MS) setState({ kind: 'slow', publication: state.publication });
      else onChanged();
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [state, product.publishedVersion, onChanged]);

  async function publish() {
    setState({ kind: 'requesting' });
    try {
      const publication = await api<PublicationResult>(`/api/owner/products/${product.id}/publish`, { method: 'POST', body: {} });
      if (publication.status === 'failed') setState({ kind: 'failed', publication });
      else if (publication.status === 'succeeded') setState({ kind: 'succeeded', versionNo: publication.versionNo });
      else setState({ kind: 'building', publication, since: Date.now() });
      onChanged();
    } catch (error) {
      setState({ kind: 'error', error });
    }
  }

  async function retry(publication: PublicationResult) {
    setState({ kind: 'requesting' });
    try {
      const result = await api<{ status: string }>(`/api/owner/publications/${publication.publicationId}/retry`, { method: 'POST', body: {} });
      const next = { ...publication, status: result.status };
      setState(result.status === 'failed' ? { kind: 'failed', publication: next } : { kind: 'building', publication: next, since: Date.now() });
    } catch (error) {
      setState({ kind: 'error', error });
    }
  }

  const validationIssues = state.kind === 'error' && isApiError(state.error) && state.error.code === 'validation_failed' ? state.error.issues : [];

  return (
    <section className="publish" aria-labelledby="publish-title">
      <div className="publish__row">
        <div>
          <p id="publish-title" className="publish__title" ref={headingRef}>Publishing</p>
          <p className="publish__lead">
            {product.publishedVersion
              ? `Version ${product.publishedVersion} is live. Publish to replace it with your saved changes.`
              : 'Not live yet. Publish to put the saved version in the shop.'}
          </p>
        </div>
        {!archived ? (
          <Button onClick={publish} busy={state.kind === 'requesting' || state.kind === 'building'} busyLabel={state.kind === 'building' ? 'Publishing…' : 'Starting…'} disabled={blockers.length > 0 || unsaved}>
            Publish
          </Button>
        ) : null}
      </div>
      {!archived && unsaved ? <p className="publish__lead">Save your changes first: Publish uses the saved version.</p> : null}
      {!archived && blockers.length > 0 ? (
        <Notice tone="info" title="Before you can publish" live="off">
          <ul className="requirements">
            {blockers.map((issue, i) => <li key={i}>{issue.message}</li>)}
          </ul>
        </Notice>
      ) : null}
      <div role="status" className="publish__status">
        {state.kind === 'building' ? (
          <Notice tone="info" title={`Publishing version ${state.publication.versionNo}`} live="off">
            <p>The shop is being rebuilt. This usually takes a minute or two; the live product changes only when the build succeeds. You can keep editing.</p>
          </Notice>
        ) : null}
        {state.kind === 'succeeded' ? (
          <Notice tone="success" title={`Version ${state.versionNo} is live`} live="off">
            <p>The public product page now shows this version.</p>
          </Notice>
        ) : null}
        {state.kind === 'slow' ? (
          <Notice tone="info" title="Publishing is taking longer than usual" live="off" actions={<Button variant="secondary" onClick={() => { setState({ kind: 'building', publication: state.publication, since: Date.now() }); onChanged(); }}>Check again</Button>}>
            <p>The build has not reported back yet. If it failed, the build log in your repository explains why.</p>
          </Notice>
        ) : null}
        {state.kind === 'failed' ? (
          <Notice tone="danger" title="Publishing failed" live="off" actions={<Button onClick={() => retry(state.publication)}>Retry publishing</Button>}>
            <p>The live shop is unchanged. Retrying uses the same snapshot of version {state.publication.versionNo}.</p>
          </Notice>
        ) : null}
      </div>
      {validationIssues.length > 0 ? (
        <Notice tone="danger" title="Fix these before publishing" live="assertive">
          <ul className="requirements">{validationIssues.map((i, n) => <li key={n}>{i.message}</li>)}</ul>
        </Notice>
      ) : state.kind === 'error' ? <ErrorNotice title="Publishing did not start" error={state.error} /> : null}
    </section>
  );
}
