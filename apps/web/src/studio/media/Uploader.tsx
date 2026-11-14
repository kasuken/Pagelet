import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Notice } from '../../components/Notice';
import { ApiError } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { abortUpload, ACCEPT, finalizeUpload, issueUpload, mimeFor, putToStorage, UploadTransferError, type AssetKind, type AssetView, type IssuedUpload } from '../../lib/upload';

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading'; loaded: number; total: number }
  | { kind: 'checking' }
  | { kind: 'done'; asset: AssetView }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: unknown; stage: 'issue' | 'transfer' | 'finalize' };

const KIND_LABEL: Record<AssetKind, string> = {
  file: 'file',
  video: 'video (MP4)',
  caption: 'captions (WebVTT)',
  cover: 'cover image (PNG or JPEG)',
  logo: 'logo (PNG or JPEG)',
};

export interface UploaderProps {
  kind: AssetKind;
  productId?: string;
  label: string;
  description?: string;
  replacesAssetId?: string;
  versionLabel?: string;
  onUploaded: (asset: AssetView) => void;
}

/**
 * Direct-to-storage upload: issue a write URL, PUT with progress, then ask the API to verify and finalize.
 * Cancel aborts the transfer and removes the pending upload; Retry resumes from the failed step.
 */
export function Uploader({ kind, productId, label, description, replacesAssetId, versionLabel, onUploaded }: UploaderProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const issued = useRef<IssuedUpload | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  function choose(next: File | null) {
    setPhase({ kind: 'idle' });
    issued.current = null;
    setFileError(undefined);
    if (!next) {
      setFile(null);
      return;
    }
    if (!mimeFor(next, kind)) {
      setFile(null);
      setFileError(`Choose a ${KIND_LABEL[kind]}. This file type is not accepted.`);
      return;
    }
    setFile(next);
  }

  async function run(from: 'issue' | 'transfer' | 'finalize' = 'issue') {
    if (!file) return;
    const mimeType = mimeFor(file, kind);
    if (!mimeType) return;
    let current = issued.current;
    try {
      if (from === 'issue' || !current || (from === 'transfer' && Date.parse(current.upload.expiresAt) < Date.now() + 30_000)) {
        setPhase({ kind: 'uploading', loaded: 0, total: file.size });
        current = await issueUpload({ kind, productId, mimeType, declaredBytes: file.size, versionLabel: versionLabel || undefined, replacesAssetId });
        issued.current = current;
        from = 'transfer';
      }
      if (from === 'transfer') {
        controller.current = new AbortController();
        setPhase({ kind: 'uploading', loaded: 0, total: file.size });
        await putToStorage(file, current.upload, {
          signal: controller.current.signal,
          onProgress: (loaded, total) => setPhase({ kind: 'uploading', loaded, total }),
        });
      }
      setPhase({ kind: 'checking' });
      const { asset } = await finalizeUpload(current.asset.id);
      setPhase({ kind: 'done', asset });
      if (asset.status === 'ready') onUploaded(asset);
    } catch (error) {
      if (error instanceof UploadTransferError && error.aborted) return;
      const stage = !issued.current ? 'issue' : error instanceof UploadTransferError ? 'transfer' : 'finalize';
      setPhase({ kind: 'failed', error: error instanceof UploadTransferError ? new ApiError({ status: error.status, code: 'network_error', message: error.message, requestId: 'storage' }) : error, stage });
    }
  }

  async function cancel() {
    controller.current?.abort();
    const pending = issued.current;
    issued.current = null;
    setPhase({ kind: 'cancelled' });
    if (pending) await abortUpload(pending.asset.id).catch(() => undefined);
  }

  const busy = phase.kind === 'uploading' || phase.kind === 'checking';
  const percent = phase.kind === 'uploading' && phase.total > 0 ? Math.round((phase.loaded / phase.total) * 100) : 0;

  return (
    <div className="uploader">
      <div className="field">
        <label className="field__label" htmlFor={id}>{label}</label>
        {description ? <p className="field__description" id={`${id}-d`}>{description}</p> : null}
        <input
          ref={inputRef}
          id={id}
          type="file"
          className="uploader__input"
          accept={ACCEPT[kind].join(',')}
          disabled={busy}
          aria-describedby={[description ? `${id}-d` : '', fileError ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined}
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />
        {fileError ? <p className="field__error" id={`${id}-e`}>{fileError}</p> : null}
      </div>
      {file ? (
        <p className="uploader__file">
          {file.name}, {formatBytes(file.size)}
        </p>
      ) : null}

      {phase.kind === 'uploading' ? (
        <div className="uploader__progress">
          <progress max={100} value={percent} aria-label={`Uploading ${file?.name ?? 'file'}`}>{percent}%</progress>
          <span className="tabular" aria-hidden="true">{percent}%</span>
        </div>
      ) : null}
      <p className="visually-hidden" role="status">
        {phase.kind === 'uploading' && (percent === 0 || percent === 100 || percent % 25 === 0) ? `Upload ${percent}% complete` : ''}
        {phase.kind === 'checking' ? 'Checking the file' : ''}
        {phase.kind === 'done' ? (phase.asset.status === 'ready' ? 'Upload complete' : 'Upload rejected') : ''}
      </p>

      <div className="uploader__actions">
        {phase.kind === 'idle' || phase.kind === 'cancelled' ? (
          <Button variant="secondary" disabled={!file} onClick={() => run('issue')}>Upload</Button>
        ) : null}
        {phase.kind === 'uploading' ? <Button variant="secondary" onClick={cancel}>Cancel upload</Button> : null}
        {phase.kind === 'checking' ? <Button variant="secondary" busy busyLabel="Checking the file…">Checking</Button> : null}
        {phase.kind === 'failed' ? (
          <>
            <Button variant="secondary" onClick={() => run(phase.stage)}>Retry upload</Button>
            <Button variant="quiet" onClick={cancel}>Cancel</Button>
          </>
        ) : null}
      </div>

      {phase.kind === 'cancelled' ? <Notice tone="info"><p>Upload cancelled. Nothing was saved.</p></Notice> : null}
      {phase.kind === 'failed' ? (
        <ErrorNotice
          title={phase.stage === 'transfer' ? 'The upload stopped' : phase.stage === 'finalize' ? 'The file could not be checked' : 'The upload could not start'}
          error={phase.error}
        />
      ) : null}
      {phase.kind === 'done' && phase.asset.status === 'ready' ? (
        <Notice tone="success"><p>Uploaded and checked. {formatBytes(phase.asset.actualBytes ?? phase.asset.declaredBytes)}.</p></Notice>
      ) : null}
      {phase.kind === 'done' && phase.asset.status !== 'ready' ? (
        <Notice tone="danger" title="The file was rejected">
          <p>It does not match the type it claims to be, or it is damaged. Export it again and upload the new file.</p>
        </Notice>
      ) : null}
    </div>
  );
}
