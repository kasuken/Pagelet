import { useState } from 'react';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { downloadAsset, fileTypeLabel } from './downloadAsset';

export function ResourceList({ resources, headingId = 'resources-title', title = 'Resources' }: { resources: Array<{ assetId: string; versionLabel: string; mimeType: string }>; headingId?: string; title?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (resources.length === 0) return null;

  async function download(assetId: string) {
    setBusy(assetId);
    setError(null);
    try {
      await downloadAsset(assetId);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="resources" aria-labelledby={headingId}>
      <h2 id={headingId} className="lesson__section-title">{title}</h2>
      <ul className="resources__list">
        {resources.map((r, i) => {
          const name = `${fileTypeLabel(r.mimeType)} ${i + 1}, version ${r.versionLabel}`;
          return (
            <li key={r.assetId} className="resources__item">
              <span className="resources__icon" aria-hidden="true">{fileTypeLabel(r.mimeType).split(' ')[0]}</span>
              <span className="resources__name">{name}</span>
              <Button variant="secondary" busy={busy === r.assetId} busyLabel="Preparing…" onClick={() => download(r.assetId)}>
                Download<span className="visually-hidden">: {name}</span>
              </Button>
            </li>
          );
        })}
      </ul>
      {error ? <ErrorNotice title="The download could not start" error={error} /> : null}
    </section>
  );
}
