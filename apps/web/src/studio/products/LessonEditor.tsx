import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Field } from '../../components/Field';
import { CheckboxField, SelectField, TextAreaField } from '../../components/FormControls';
import { api } from '../../lib/api';
import type { OwnerLesson } from '../../lib/types';
import { Uploader } from '../media/Uploader';
import { issuesByPath } from '../common';

export function LessonEditor({ productId, lesson, readOnly, onSaved, onDirty }: { productId: string; lesson: OwnerLesson; readOnly: boolean; onSaved: () => void; onDirty: (dirty: boolean) => void }) {
  const initial = useMemo(() => ({ title: lesson.title, kind: lesson.kind, isPreview: lesson.isPreview, bodyHtml: lesson.bodyHtml, transcript: lesson.transcript }), [lesson]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  // Reset only when the saved values change, not on every reload of the same data (publish polling, uploads, reorders).
  const initialKey = JSON.stringify(initial);
  useEffect(() => setForm(JSON.parse(initialKey) as typeof initial), [initialKey]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const issues = issuesByPath(error);

  async function patch(body: Record<string, unknown>) {
    setError(null);
    setSaved(false);
    await api(`/api/owner/lessons/${lesson.id}`, { method: 'PATCH', body });
    setSaved(true);
    onSaved();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true);
    try {
      const changes: Record<string, unknown> = {};
      for (const key of Object.keys(form) as Array<keyof typeof form>) if (form[key] !== initial[key]) changes[key] = form[key];
      await patch(changes);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function attach(body: Record<string, unknown>) {
    try {
      await patch(body);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="lesson-editor">
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Lesson title" value={form.title} maxLength={160} disabled={readOnly} error={issues.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <SelectField label="Kind" value={form.kind} disabled={readOnly} onChange={(e) => setForm({ ...form, kind: e.target.value as 'video' | 'text' })}>
          <option value="video">Video</option>
          <option value="text">Text</option>
        </SelectField>
        <CheckboxField label="Free preview" description="Visitors see this lesson’s title marked as a preview on the product page." checked={form.isPreview} disabled={readOnly} onChange={(v) => setForm({ ...form, isPreview: v })} />
        <TextAreaField label="Lesson text" description="Paragraphs, headings (h2–h4), lists, bold, italic and https links are kept. Everything else is removed when you save." rows={8} value={form.bodyHtml} disabled={readOnly} error={issues.bodyHtml} onChange={(e) => setForm({ ...form, bodyHtml: e.target.value })} />
        {form.kind === 'video' ? (
          <TextAreaField label="Transcript" description="The full spoken text. Required for video lessons so everyone can follow." rows={6} value={form.transcript} disabled={readOnly} error={issues.transcript} onChange={(e) => setForm({ ...form, transcript: e.target.value })} />
        ) : null}
        <div className="form-actions">
          <Button type="submit" disabled={!dirty || readOnly} busy={busy} busyLabel="Saving…">Save lesson</Button>
          {dirty ? <span className="form-actions__note">Unsaved changes</span> : null}
          <p className="save-status" role="status">{saved && !dirty ? 'Saved' : ''}</p>
        </div>
      </form>
      {error ? <ErrorNotice title="The lesson was not saved" error={error} /> : null}

      {!readOnly && form.kind === 'video' ? (
        <div className="lesson-editor__media">
          <div>
            <p className="field__description">{lesson.videoAssetId ? 'Video attached. Upload a new MP4 to replace it.' : 'No video attached yet.'}</p>
            <Uploader kind="video" productId={productId} label="Video" description="MP4 with H.264 video and AAC audio. Pagelet does not convert video." onUploaded={(asset) => attach({ videoAssetId: asset.id })} />
          </div>
          <div>
            <p className="field__description">{lesson.captionAssetId ? 'Captions attached.' : 'No captions yet.'}</p>
            <Uploader kind="caption" productId={productId} label="Captions" description="A WebVTT (.vtt) file." onUploaded={(asset) => attach({ captionAssetId: asset.id })} />
          </div>
        </div>
      ) : null}
      {!readOnly ? (
        <div className="lesson-editor__resources">
          <h4 className="editor__section-title">Resources</h4>
          {lesson.resourceAssetIds.length === 0 ? <p className="list-editor__empty">No downloadable resources.</p> : (
            <ul className="list-editor__items">
              {lesson.resourceAssetIds.map((id, i) => (
                <li key={id} className="list-editor__item list-editor__item--row">
                  <span>Resource {i + 1}</span>
                  <Button variant="quiet" onClick={() => attach({ resourceAssetIds: lesson.resourceAssetIds.filter((r) => r !== id) })}>
                    Remove<span className="visually-hidden">: resource {i + 1}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {lesson.resourceAssetIds.length < 20 ? (
            <Uploader kind="file" productId={productId} label="Add a resource" description="PDF, EPUB, ZIP, MP3, PNG or JPEG." onUploaded={(asset) => attach({ resourceAssetIds: [...lesson.resourceAssetIds, asset.id] })} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
