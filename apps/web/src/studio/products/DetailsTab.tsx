import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Field } from '../../components/Field';
import { ErrorSummary, SelectField, TextAreaField } from '../../components/FormControls';
import { MoveButtons, moveItem } from '../../components/MoveButtons';
import { Notice } from '../../components/Notice';
import { api } from '../../lib/api';
import type { OwnerProductDetail } from '../../lib/types';
import { Uploader } from '../media/Uploader';
import { issuesByPath, StaleNotice, StaleRevisionError } from '../common';
import { saveProduct } from './saveProduct';

interface Props {
  product: OwnerProductDetail;
  readOnly: boolean;
  onSaved: (product: OwnerProductDetail) => void;
  onReload: () => void;
  onDirty: (dirty: boolean) => void;
}

export function DetailsTab({ product, readOnly, onSaved, onReload, onDirty }: Props) {
  const navigate = useNavigate();
  const initial = useMemo(() => ({ title: product.title, slug: product.slug, description: product.description, outcomes: product.outcomes, coverAlt: product.coverAlt, productType: product.productType }), [product]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [dialog, setDialog] = useState<'archive' | 'delete' | null>(null);

  // Reset only when the saved values change, not on every reload of the same data (publish polling, uploads, reorders).
  const initialKey = JSON.stringify(initial);
  useEffect(() => setForm(JSON.parse(initialKey) as typeof initial), [initialKey]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const issues = issuesByPath(error);
  const summary = Object.entries(issues)
    .filter(([path]) => !path.includes('.'))
    .map(([path, message]) => ({ id: `details-${path}`, message }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || readOnly) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(form) as Array<keyof typeof form>) {
      if (JSON.stringify(form[key]) !== JSON.stringify(initial[key])) changes[key] = key === 'outcomes' ? form.outcomes.map((o) => o.trim()).filter(Boolean) : form[key];
    }
    try {
      onSaved(await saveProduct(product, changes));
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function setCover(assetId: string) {
    setError(null);
    try {
      onSaved(await saveProduct(product, { coverAssetId: assetId }));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="editor">
      {error instanceof StaleRevisionError ? <StaleNotice error={error} onReload={onReload} /> : null}
      <form className="stack" onSubmit={submit} noValidate>
        <ErrorSummary errors={summary} />
        <Field id="details-title" label="Title" value={form.title} maxLength={160} disabled={readOnly} error={issues.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Field id="details-slug" label="Web address" description={`/products/${form.slug}. Changing it breaks old links to this product.`} value={form.slug} maxLength={80} spellCheck={false} disabled={readOnly} error={issues.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
        {product.status === 'draft' ? (
          <SelectField id="details-productType" label="Type" description="Only drafts without curriculum or files can change type." value={form.productType} disabled={readOnly} error={issues.productType} onChange={(e) => setForm({ ...form, productType: e.target.value as 'course' | 'download' })}>
            <option value="course">Course</option>
            <option value="download">Download</option>
          </SelectField>
        ) : null}
        <TextAreaField id="details-description" label="Description" description="Plain text. Leave a blank line between paragraphs." rows={8} value={form.description} maxLength={20000} disabled={readOnly} error={issues.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

        <fieldset className="list-editor">
          <legend className="field__label">Outcomes</legend>
          <p className="field__description">What a buyer can do afterwards. Up to 12, one sentence each.</p>
          {form.outcomes.length === 0 ? <p className="list-editor__empty">No outcomes yet.</p> : null}
          <ol className="list-editor__items">
            {form.outcomes.map((outcome, i) => (
              <li key={i} className="list-editor__item">
                <Field label={`Outcome ${i + 1}`} value={outcome} maxLength={200} disabled={readOnly} onChange={(e) => setForm({ ...form, outcomes: form.outcomes.map((o, j) => (j === i ? e.target.value : o)) })} />
                {!readOnly ? (
                  <span className="list-editor__controls">
                    <MoveButtons itemLabel={`outcome ${i + 1}`} index={i} count={form.outcomes.length} onMove={(a, b) => setForm({ ...form, outcomes: moveItem(form.outcomes, a, b) })} />
                    <Button variant="quiet" onClick={() => setForm({ ...form, outcomes: form.outcomes.filter((_, j) => j !== i) })}>
                      Remove<span className="visually-hidden">: outcome {i + 1}</span>
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {!readOnly && form.outcomes.length < 12 ? (
            <Button variant="secondary" onClick={() => setForm({ ...form, outcomes: [...form.outcomes, ''] })}>Add an outcome</Button>
          ) : null}
        </fieldset>

        <Field id="details-coverAlt" label="Cover description" description="Describe the cover for people who cannot see it. Leave empty if it only repeats the title." value={form.coverAlt} maxLength={300} disabled={readOnly} error={issues.coverAlt} onChange={(e) => setForm({ ...form, coverAlt: e.target.value })} />

        <div className="form-actions">
          <Button type="submit" disabled={!dirty || readOnly} busy={busy} busyLabel="Saving…">Save details</Button>
          {dirty ? <span className="form-actions__note">Unsaved changes</span> : null}
          <p className="save-status" role="status">{saved && !dirty ? 'Saved' : ''}</p>
        </div>
        {error && !(error instanceof StaleRevisionError) && summary.length === 0 ? <ErrorNotice title="Details were not saved" error={error} /> : null}
      </form>

      <section className="editor__section" aria-labelledby="cover-title">
        <h2 id="cover-title" className="editor__section-title">Cover image</h2>
        <p className="field__description">{product.coverAssetId ? 'A cover is set. Upload a new image to replace it.' : 'No cover yet. A cover is required before publishing.'}</p>
        {!readOnly ? <Uploader kind="cover" productId={product.id} label="Choose a cover image" description="PNG or JPEG, up to 10 MB." onUploaded={(asset) => setCover(asset.id)} /> : null}
      </section>

      {!readOnly ? (
        <section className="editor__section editor__section--danger" aria-labelledby="lifecycle-title">
          <h2 id="lifecycle-title" className="editor__section-title">Remove from sale</h2>
          {product.status === 'draft' ? (
            <>
              <p className="field__description">Deleting a draft removes it and its files. Products that were sold cannot be deleted; archive them instead.</p>
              <Button variant="secondary" onClick={() => setDialog('delete')}>Delete draft</Button>
            </>
          ) : (
            <>
              <p className="field__description">Archiving takes the product out of the shop after the next build. Buyers keep their access and receipts.</p>
              <Button variant="secondary" onClick={() => setDialog('archive')}>Archive product</Button>
            </>
          )}
        </section>
      ) : null}

      <ConfirmDialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        title="Delete this draft?"
        confirmLabel="Delete draft"
        busyLabel="Deleting…"
        onConfirm={async () => {
          await api(`/api/owner/products/${encodeURIComponent(product.id)}?revision=${product.revision}`, { method: 'DELETE' });
          navigate('/studio/products', { replace: true });
        }}
      >
        <p>{product.title} and its uploaded files will be removed. Nobody has bought it, so no buyer is affected.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'archive'}
        onClose={() => setDialog(null)}
        title="Archive this product?"
        confirmLabel="Archive product"
        busyLabel="Archiving…"
        onConfirm={async () => {
          await api(`/api/owner/products/${encodeURIComponent(product.id)}/archive`, { method: 'POST', body: {} });
          onReload();
        }}
      >
        <p>{product.title} leaves the public shop after the next build. Everyone who bought it keeps access. Archived products are read-only.</p>
      </ConfirmDialog>
      {readOnly ? <Notice tone="info"><p>Editing is turned off for archived products.</p></Notice> : null}
    </div>
  );
}
