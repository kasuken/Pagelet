import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNotice } from '../../components/ErrorNotice';
import { Field } from '../../components/Field';
import { SelectField } from '../../components/FormControls';
import { moveItem } from '../../components/MoveButtons';
import { api } from '../../lib/api';
import type { OwnerLesson, OwnerProductDetail, OwnerSection } from '../../lib/types';
import { LessonEditor } from './LessonEditor';

interface Props {
  product: OwnerProductDetail;
  readOnly: boolean;
  onChanged: () => void;
  onDirty: (dirty: boolean) => void;
}

type Pending = { kind: 'section' | 'lesson'; id: string; title: string } | null;

/** C02 curriculum: sections and lessons with explicit Move up / Move down controls. */
export function CurriculumTab({ product, readOnly, onChanged, onDirty }: Props) {
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<Pending>(null);
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    if (!focusAfter.current) return;
    const el = document.getElementById(focusAfter.current) as HTMLButtonElement | null;
    focusAfter.current = null;
    if (el && !el.disabled) el.focus();
    else (el?.parentElement?.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus();
  }, [product]);

  async function run(action: () => Promise<unknown>, message: string, focusId?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setAnnouncement(message);
      focusAfter.current = focusId ?? null;
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function moveSection(from: number, to: number) {
    const ids = moveItem(product.sections, from, to).map((s) => s.id);
    const section = product.sections[from]!;
    void run(
      () => api(`/api/owner/products/${product.id}/sections/reorder`, { method: 'POST', body: { ids } }),
      `Moved section ${section.title} to position ${to + 1} of ${ids.length}.`,
      `${to < from ? 'up' : 'down'}-${section.id}`,
    );
  }

  function moveLesson(section: OwnerSection, from: number, to: number) {
    const ids = moveItem(section.lessons, from, to).map((l) => l.id);
    const lesson = section.lessons[from]!;
    void run(
      () => api(`/api/owner/sections/${section.id}/lessons/reorder`, { method: 'POST', body: { ids } }),
      `Moved lesson ${lesson.title} to position ${to + 1} of ${ids.length}.`,
      `${to < from ? 'up' : 'down'}-${lesson.id}`,
    );
  }

  return (
    <div className="editor curriculum-editor">
      <p className="visually-hidden" role="status">{announcement}</p>
      {error ? <ErrorNotice title="That change was not saved" error={error} /> : null}
      {product.sections.length === 0 ? (
        <EmptyState title="Add the first section" headingLevel={3}>
          <p>Sections group lessons, for example “Getting started”. Add a section, then its lessons.</p>
        </EmptyState>
      ) : (
        <ol className="sections">
          {product.sections.map((section, sIndex) => (
            <li key={section.id} className="section-card">
              <div className="section-card__head">
                <SectionTitle section={section} readOnly={readOnly} onSaved={(title) => run(() => api(`/api/owner/sections/${section.id}`, { method: 'PATCH', body: { title } }), `Renamed section to ${title}.`)} />
                {!readOnly ? (
                  <span className="section-card__controls">
                    <MoveIds id={section.id} label={`section ${section.title}`} index={sIndex} count={product.sections.length} onMove={moveSection} disabled={busy} />
                    <Button variant="quiet" onClick={() => setToDelete({ kind: 'section', id: section.id, title: section.title })}>
                      Delete<span className="visually-hidden">: section {section.title}</span>
                    </Button>
                  </span>
                ) : null}
              </div>
              {section.lessons.length === 0 ? <p className="list-editor__empty">No lessons in this section yet.</p> : null}
              <ol className="lessons">
                {section.lessons.map((lesson, lIndex) => (
                  <li key={lesson.id} className="lesson-row">
                    <div className="lesson-row__head">
                      <span className="lesson-row__title">
                        {lesson.title}
                        <span className="lesson-row__meta">
                          {lesson.kind === 'video' ? 'Video' : 'Text'}
                          {lesson.isPreview ? ', free preview' : ''}
                          {lesson.kind === 'video' && !lesson.videoAssetId ? ', no video yet' : ''}
                        </span>
                      </span>
                      <span className="lesson-row__controls">
                        <Button variant="secondary" aria-expanded={openLesson === lesson.id} aria-controls={`lesson-editor-${lesson.id}`} onClick={() => setOpenLesson(openLesson === lesson.id ? null : lesson.id)}>
                          {openLesson === lesson.id ? 'Close' : 'Edit'}<span className="visually-hidden">: {lesson.title}</span>
                        </Button>
                        {!readOnly ? (
                          <>
                            <MoveIds id={lesson.id} label={`lesson ${lesson.title}`} index={lIndex} count={section.lessons.length} onMove={(a, b) => moveLesson(section, a, b)} disabled={busy} />
                            <Button variant="quiet" onClick={() => setToDelete({ kind: 'lesson', id: lesson.id, title: lesson.title })}>
                              Delete<span className="visually-hidden">: lesson {lesson.title}</span>
                            </Button>
                          </>
                        ) : null}
                      </span>
                    </div>
                    {openLesson === lesson.id ? (
                      <div id={`lesson-editor-${lesson.id}`}>
                        <LessonEditor productId={product.id} lesson={lesson} readOnly={readOnly} onSaved={onChanged} onDirty={onDirty} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
              {!readOnly ? <AddLesson section={section} onAdd={(title, kind) => run(() => api<{ lesson: OwnerLesson }>(`/api/owner/sections/${section.id}/lessons`, { method: 'POST', body: { title, kind } }), `Added lesson ${title}.`)} /> : null}
            </li>
          ))}
        </ol>
      )}
      {!readOnly ? <AddSection onAdd={(title) => run(() => api(`/api/owner/products/${product.id}/sections`, { method: 'POST', body: { title } }), `Added section ${title}.`)} /> : null}

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title={toDelete?.kind === 'section' ? 'Delete this section?' : 'Delete this lesson?'}
        confirmLabel={toDelete?.kind === 'section' ? 'Delete section' : 'Delete lesson'}
        busyLabel="Deleting…"
        onConfirm={async () => {
          if (!toDelete) return;
          await api(`/api/owner/${toDelete.kind === 'section' ? 'sections' : 'lessons'}/${toDelete.id}`, { method: 'DELETE' });
          setAnnouncement(`Deleted ${toDelete.kind} ${toDelete.title}.`);
          onChanged();
        }}
      >
        <p>
          {toDelete?.kind === 'section' ? `“${toDelete?.title}” and all of its lessons will be removed from the draft.` : `“${toDelete?.title}” will be removed from the draft.`}{' '}
          {product.publishedVersion ? 'Buyers keep seeing the published version until you publish again; after that, their progress on removed lessons no longer shows.' : ''}
        </p>
      </ConfirmDialog>
    </div>
  );
}

function MoveIds({ id, label, index, count, onMove, disabled }: { id: string; label: string; index: number; count: number; onMove: (from: number, to: number) => void; disabled?: boolean }) {
  // Stable ids let focus follow the item after the list reloads.
  return (
    <span className="move-buttons">
      <Button id={`up-${id}`} variant="quiet" disabled={disabled || index === 0} onClick={() => onMove(index, index - 1)}>
        Move up<span className="visually-hidden">: {label}</span>
      </Button>
      <Button id={`down-${id}`} variant="quiet" disabled={disabled || index === count - 1} onClick={() => onMove(index, index + 1)}>
        Move down<span className="visually-hidden">: {label}</span>
      </Button>
    </span>
  );
}

function SectionTitle({ section, readOnly, onSaved }: { section: OwnerSection; readOnly: boolean; onSaved: (title: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(section.title);
  useEffect(() => setTitle(section.title), [section.title]);
  if (!editing || readOnly) {
    return (
      <h3 className="section-card__title">
        {section.title}
        {!readOnly ? (
          <Button variant="quiet" onClick={() => setEditing(true)}>
            Rename<span className="visually-hidden">: section {section.title}</span>
          </Button>
        ) : null}
      </h3>
    );
  }
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        await onSaved(title.trim());
        setEditing(false);
      }}
    >
      <Field label="Section title" value={title} maxLength={160} autoFocus onChange={(e) => setTitle(e.target.value)} />
      <Button type="submit" variant="secondary">Save</Button>
      <Button variant="quiet" onClick={() => { setTitle(section.title); setEditing(false); }}>Cancel</Button>
    </form>
  );
}

function AddSection({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Enter a section title.');
      return;
    }
    await onAdd(title.trim());
    setTitle('');
  }
  return (
    <form className="inline-form add-form" onSubmit={submit} noValidate>
      <Field label="New section" value={title} maxLength={160} error={error} onChange={(e) => { setTitle(e.target.value); setError(undefined); }} />
      <Button type="submit" variant="secondary">Add section</Button>
    </form>
  );
}

function AddLesson({ section, onAdd }: { section: OwnerSection; onAdd: (title: string, kind: 'video' | 'text') => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'video' | 'text'>('video');
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Enter a lesson title.');
      return;
    }
    await onAdd(title.trim(), kind);
    setTitle('');
  }
  return (
    <form className="inline-form add-form" onSubmit={submit} noValidate aria-label={`Add a lesson to ${section.title}`}>
      <Field label="New lesson" value={title} maxLength={160} error={error} onChange={(e) => { setTitle(e.target.value); setError(undefined); }} />
      <SelectField label="Kind" value={kind} onChange={(e) => setKind(e.target.value as 'video' | 'text')}>
        <option value="video">Video</option>
        <option value="text">Text</option>
      </SelectField>
      <Button type="submit" variant="secondary">Add lesson</Button>
    </form>
  );
}
