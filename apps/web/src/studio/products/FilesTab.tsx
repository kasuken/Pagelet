import { useState } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { api } from '../../lib/api';
import { formatBytes, formatDate } from '../../lib/format';
import type { OwnerFile, OwnerProductDetail } from '../../lib/types';
import { fileTypeLabel } from '../../learn/downloadAsset';
import { Uploader } from '../media/Uploader';

/** C03 files for download products: versioned uploads with progress, cancel and retry. */
export function FilesTab({ product, readOnly, onChanged }: { product: OwnerProductDetail; readOnly: boolean; onChanged: () => void }) {
  const [versionLabel, setVersionLabel] = useState('v1');
  const [replaces, setReplaces] = useState<OwnerFile | null>(null);
  const [toDelete, setToDelete] = useState<OwnerFile | null>(null);

  return (
    <div className="editor">
      {product.files.length === 0 ? (
        <EmptyState title="Upload the first file" headingLevel={3}>
          <p>Buyers download these files after purchase through short-lived, private links.</p>
        </EmptyState>
      ) : (
        <div className="table-scroll" role="region" aria-label="Files" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Status</th>
                <th scope="col" className="data-table__num">Size</th>
                <th scope="col">Added</th>
                {!readOnly ? <th scope="col"><span className="visually-hidden">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {product.files.map((f) => (
                <tr key={f.id}>
                  <td>
                    <span className="data-table__primary">
                      {fileTypeLabel(f.mimeType)}, {f.versionLabel}
                      {f.replacesAssetId ? <span className="data-table__secondary">Replaces an earlier version</span> : null}
                    </span>
                  </td>
                  <td><Badge tone={f.status === 'ready' ? 'success' : f.status === 'rejected' ? 'danger' : 'neutral'}>{f.status === 'ready' ? 'Ready' : f.status === 'pending_upload' ? 'Not uploaded' : f.status}</Badge></td>
                  <td className="data-table__num tabular">{formatBytes(f.actualBytes ?? f.declaredBytes)}</td>
                  <td>{formatDate(f.finalizedAt ?? f.createdAt)}</td>
                  {!readOnly ? (
                    <td className="data-table__actions">
                      <Button variant="quiet" onClick={() => { setReplaces(f); setVersionLabel(nextVersion(f.versionLabel)); }}>
                        Replace<span className="visually-hidden">: {f.versionLabel}</span>
                      </Button>
                      <Button variant="quiet" onClick={() => setToDelete(f)}>
                        Delete<span className="visually-hidden">: {f.versionLabel}</span>
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!readOnly ? (
        <section className="editor__section" aria-labelledby="upload-file-title">
          <h3 id="upload-file-title" className="editor__section-title">{replaces ? `Replace ${replaces.versionLabel}` : 'Add a file'}</h3>
          {replaces ? <p className="field__description">The new file becomes the current version. Buyers who already downloaded the old one keep it. <Button variant="quiet" onClick={() => setReplaces(null)}>Add a separate file instead</Button></p> : null}
          <Field label="Version label" description="Letters, numbers, dots, dashes and spaces, for example v2 or 2026 edition." value={versionLabel} maxLength={40} className="field--narrow" onChange={(e) => setVersionLabel(e.target.value)} />
          <Uploader
            key={replaces?.id ?? 'new'}
            kind="file"
            productId={product.id}
            label="File"
            description="PDF, EPUB, ZIP, MP3, PNG or JPEG."
            versionLabel={versionLabel.trim() || 'v1'}
            replacesAssetId={replaces?.id}
            onUploaded={() => {
              setReplaces(null);
              onChanged();
            }}
          />
        </section>
      ) : null}
      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Delete this file?"
        confirmLabel="Delete file"
        busyLabel="Deleting…"
        onConfirm={async () => {
          if (!toDelete) return;
          await api(`/api/owner/media/assets/${toDelete.id}`, { method: 'DELETE' });
          onChanged();
        }}
      >
        <p>Buyers can no longer download {toDelete?.versionLabel}. Copies they already downloaded stay with them. Files still used by a published version cannot be deleted.</p>
      </ConfirmDialog>
    </div>
  );
}

export function nextVersion(label: string): string {
  const m = /^v(\d+)$/i.exec(label.trim());
  return m ? `v${Number(m[1]) + 1}` : `${label} (new)`.slice(0, 40);
}
