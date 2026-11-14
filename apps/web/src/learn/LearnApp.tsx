import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, LinkButton } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { Notice } from '../components/Notice';
import { Skeleton } from '../components/Skeleton';
import { isApiError } from '../lib/api';
import { isSlug } from '../lib/patterns';
import { sanitizeLessonHtml } from '../lib/sanitizeHtml';
import type { LearnCurriculum, LearnLesson, LearnLessonRef } from '../lib/types';
import { useApiResource } from '../lib/useApi';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ResourceList } from './ResourceList';
import { useProgress } from './useProgress';
import { VideoPlayer } from './VideoPlayer';
import './learn.css';

/** Lesson workspace: curriculum on the left, player and lesson body on the right. Lazy-loaded. */
export default function LearnApp() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const valid = isSlug(slug);
  const { state, reload } = useApiResource<LearnCurriculum>(valid ? `/api/library/products/${encodeURIComponent(slug)}/curriculum` : null);
  const [completedLocal, setCompletedLocal] = useState<Record<string, boolean>>({});
  useDocumentTitle(state.kind === 'ready' ? state.data.product.title : 'Learning');

  useEffect(() => {
    if (state.kind === 'failed' && isApiError(state.error) && state.error.status === 401) {
      navigate(`/account/sign-in?returnTo=${encodeURIComponent(`/learn/${slug}`)}`, { replace: true });
    }
  }, [state, navigate, slug]);

  const lessons = useMemo<LearnLessonRef[]>(() => (state.kind === 'ready' ? state.data.sections.flatMap((s) => s.lessons) : []), [state]);
  const isDone = useCallback((l: LearnLessonRef) => completedLocal[l.id] ?? l.completed, [completedLocal]);
  const requested = params.get('lesson');
  const current = lessons.find((l) => l.id === requested) ?? lessons.find((l) => !isDone(l)) ?? lessons[0] ?? null;
  const index = current ? lessons.indexOf(current) : -1;
  const doneCount = lessons.filter(isDone).length;

  const go = useCallback(
    (lessonId: string) => {
      const next = new URLSearchParams(params);
      next.set('lesson', lessonId);
      setParams(next);
      document.getElementById('lesson-title')?.focus();
    },
    [params, setParams],
  );

  if (!valid || (state.kind === 'failed' && isApiError(state.error) && state.error.status === 404)) {
    return (
      <section className="page-message wrap" aria-labelledby="learn-missing">
        <h1 id="learn-missing" className="page-message__title">This course is not in your learning</h1>
        <p className="page-message__body">You may be signed in with a different email, or access to it has ended. Check My learning or sign in with the address you used to buy.</p>
        <div className="page-message__actions">
          <LinkButton to="/library">Open my learning</LinkButton>
          <LinkButton to="/account/sign-in" variant="secondary">Sign in with another email</LinkButton>
        </div>
      </section>
    );
  }
  if (state.kind === 'loading' || (state.kind === 'failed' && isApiError(state.error) && state.error.status === 401)) {
    return <div className="wrap learn"><Skeleton label="Loading your course" lines={4} /></div>;
  }
  if (state.kind === 'failed') {
    return (
      <div className="wrap learn">
        <h1 className="page-heading__title">Learning</h1>
        <ErrorNotice title="Your course did not load" error={state.error} onRetry={reload} />
      </div>
    );
  }

  const { product, sections } = state.data;

  const nav = (
    <nav aria-label="Course curriculum" className="curriculum">
      {sections.map((section) => (
        <div key={section.id} className="curriculum__section">
          <h2 className="curriculum__section-title">{section.title}</h2>
          <ol className="curriculum__lessons">
            {section.lessons.map((lesson) => {
              const active = current?.id === lesson.id;
              const done = isDone(lesson);
              return (
                <li key={lesson.id}>
                  <Link
                    to={`?lesson=${encodeURIComponent(lesson.id)}`}
                    className="curriculum__link"
                    aria-current={active ? 'step' : undefined}
                    onClick={() => requestAnimationFrame(() => document.getElementById('lesson-title')?.focus())}
                  >
                    <span className={done ? 'curriculum__mark curriculum__mark--done' : 'curriculum__mark'} aria-hidden="true">{done ? '✓' : ''}</span>
                    <span className="curriculum__text">
                      {lesson.title}
                      <span className="curriculum__meta">
                        {lesson.kind === 'video' ? 'Video' : 'Reading'}
                        {done ? ', completed' : ''}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="wrap learn">
      <div className="learn__intro">
        <p className="learn__breadcrumb"><Link to="/library">My learning</Link></p>
        <h1 className="learn__title">{product.title}</h1>
        {lessons.length > 0 ? (
          <div className="learn__progress">
            <span>{doneCount} of {lessons.length} lessons completed</span>
            <progress max={lessons.length} value={doneCount} aria-label="Course progress">{doneCount} of {lessons.length}</progress>
          </div>
        ) : null}
      </div>

      {lessons.length === 0 ? (
        <Notice tone="info" title="Your files are not listed here yet" actions={<LinkButton to="/help" variant="secondary">Contact the shop</LinkButton>}>
          <p>You own this product, but this page cannot list its files yet. Your purchase is safe. Contact the shop if you need the files now.</p>
        </Notice>
      ) : (
        <div className="learn__layout">
          <details className="learn__disclosure">
            <summary>Course contents, lesson {index + 1} of {lessons.length}</summary>
            {nav}
          </details>
          <aside className="learn__aside">{nav}</aside>
          {current ? (
            <LessonPanel
              key={current.id}
              lesson={current}
              position={index}
              total={lessons.length}
              done={isDone(current)}
              onCompleted={(value) => setCompletedLocal((m) => ({ ...m, [current.id]: value }))}
              onPrevious={index > 0 ? () => go(lessons[index - 1]!.id) : undefined}
              onNext={index < lessons.length - 1 ? () => go(lessons[index + 1]!.id) : undefined}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function LessonPanel({ lesson, position, total, done, onCompleted, onPrevious, onNext }: { lesson: LearnLessonRef; position: number; total: number; done: boolean; onCompleted: (value: boolean) => void; onPrevious?: () => void; onNext?: () => void }) {
  const { state, reload } = useApiResource<LearnLesson>(`/api/lessons/${encodeURIComponent(lesson.id)}`);
  const { state: saveState, save } = useProgress(lesson.id);
  const position_ = useRef(lesson.resumeSeconds);
  const [completeBusy, setCompleteBusy] = useState(false);

  const onPosition = useCallback(
    (seconds: number, reason: 'pause' | 'ended' | 'tick' | 'hidden') => {
      position_.current = seconds;
      void save(seconds, { keepalive: reason === 'hidden' });
    },
    [save],
  );

  async function toggleComplete() {
    setCompleteBusy(true);
    const ok = await save(position_.current, { completed: !done, force: true });
    setCompleteBusy(false);
    // Completion changes on screen only after the server confirmed the save.
    if (ok) onCompleted(!done);
  }

  return (
    <article className="lesson" aria-labelledby="lesson-title">
      {state.kind === 'loading' ? <Skeleton label="Loading the lesson" lines={4} /> : null}
      {state.kind === 'failed' ? <ErrorNotice title="This lesson did not load" error={state.error} onRetry={reload} /> : null}
      {state.kind === 'ready' ? (
        <>
          {state.data.hasVideo ? (
            <VideoPlayer lessonId={lesson.id} title={state.data.title} hasCaptions={state.data.hasCaptions} onPosition={onPosition} />
          ) : null}
          <div className="lesson__heading">
            <div>
              <p className="lesson__meta">Lesson {position + 1} of {total}, {state.data.kind === 'video' ? 'video' : 'reading'}</p>
              <h2 id="lesson-title" className="lesson__title" tabIndex={-1}>{state.data.title}</h2>
            </div>
            <div className="lesson__complete">
              <Button
                variant={done ? 'secondary' : 'primary'}
                busy={completeBusy}
                busyLabel="Saving…"
                aria-pressed={done}
                onClick={toggleComplete}
              >
                {done ? 'Completed' : 'Mark complete'}
              </Button>
              <SaveStatus state={saveState} />
            </div>
          </div>
          {state.data.hasVideo && !state.data.hasCaptions ? <p className="lesson__note">This video has no captions. The transcript below has the full text.</p> : null}
          {state.data.bodyHtml ? (
            <div className="lesson__body prose" dangerouslySetInnerHTML={{ __html: sanitizeLessonHtml(state.data.bodyHtml) }} />
          ) : null}
          {state.data.transcript ? (
            <details className="lesson__transcript">
              <summary>Read the transcript</summary>
              <div className="prose">
                {state.data.transcript.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}
              </div>
            </details>
          ) : state.data.hasVideo ? (
            <p className="lesson__note">No transcript has been added for this video yet.</p>
          ) : null}
          <ResourceList resources={state.data.resources} />
          <nav className="lesson__pager" aria-label="Lesson navigation">
            {onPrevious ? <Button variant="secondary" onClick={onPrevious}>Previous lesson</Button> : <span />}
            {onNext ? <Button variant="secondary" onClick={onNext}>Next lesson</Button> : null}
          </nav>
        </>
      ) : null}
    </article>
  );
}

function SaveStatus({ state }: { state: ReturnType<typeof useProgress>['state'] }) {
  return (
    <p className="save-status" role="status">
      {state.kind === 'saving' ? 'Saving…' : null}
      {state.kind === 'saved' ? 'Saved' : null}
      {state.kind === 'failed' ? <span className="save-status--failed">Not saved. Check your connection; we will try again when you pause.</span> : null}
    </p>
  );
}
