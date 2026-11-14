import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorNotice } from '../components/ErrorNotice';
import { Skeleton } from '../components/Skeleton';
import { api } from '../lib/api';
import type { Playback } from '../lib/types';

export interface VideoPlayerProps {
  lessonId: string;
  title: string;
  hasCaptions: boolean;
  /** Called with the current position; the parent decides when to save. */
  onPosition: (seconds: number, reason: 'pause' | 'ended' | 'tick' | 'hidden') => void;
}

function isHttps(url: string) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Native video player with captions. Playback URLs are short-lived: on a load error the player asks for a new
 * URL once and continues from the same position. No autoplay.
 */
export function VideoPlayer({ lessonId, title, hasCaptions, onPosition }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [video, setVideo] = useState<Playback | null>(null);
  const [captionUrl, setCaptionUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const resumeAt = useRef<number | null>(null);
  const refreshed = useRef(false);
  const lastTick = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    const base = `/api/lessons/${encodeURIComponent(lessonId)}/playback`;
    Promise.all([
      api<Playback>(`${base}?track=video`, { signal: controller.signal }),
      hasCaptions ? api<Playback>(`${base}?track=caption`, { signal: controller.signal }).catch(() => null) : Promise.resolve(null),
    ])
      .then(([v, c]) => {
        if (!isHttps(v.url)) throw new Error('Unexpected playback address.');
        if (resumeAt.current === null) resumeAt.current = v.resumeSeconds;
        setVideo(v);
        setCaptionUrl(c && isHttps(c.url) ? c.url : null);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e);
      });
    return () => controller.abort();
  }, [lessonId, hasCaptions, attempt]);

  const onLoadedMetadata = useCallback(() => {
    const el = videoRef.current;
    const at = resumeAt.current;
    if (el && at && at > 0 && (!Number.isFinite(el.duration) || at < el.duration - 3)) el.currentTime = at;
  }, []);

  const onError = useCallback(() => {
    // Most likely an expired URL: fetch a fresh one once and resume where the viewer was.
    if (refreshed.current) return;
    refreshed.current = true;
    resumeAt.current = videoRef.current?.currentTime || resumeAt.current;
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const onHidden = () => {
      const el = videoRef.current;
      if (document.visibilityState === 'hidden' && el && el.currentTime > 0) onPosition(el.currentTime, 'hidden');
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [onPosition]);

  if (error) {
    return <ErrorNotice title="The video could not load" error={error} onRetry={() => { refreshed.current = false; setAttempt((n) => n + 1); }} />;
  }
  if (!video) {
    return (
      <div className="player player--loading">
        <Skeleton label="Loading the video" lines={1} />
      </div>
    );
  }

  return (
    <div className="player">
      <video
        ref={videoRef}
        className="player__video"
        src={video.url}
        controls
        preload="metadata"
        playsInline
        crossOrigin="anonymous"
        aria-label={`Video: ${title}`}
        onLoadedMetadata={onLoadedMetadata}
        onError={onError}
        onPause={(e) => onPosition(e.currentTarget.currentTime, 'pause')}
        onEnded={(e) => onPosition(e.currentTarget.currentTime, 'ended')}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          if (Math.abs(t - lastTick.current) >= 30) {
            lastTick.current = t;
            onPosition(t, 'tick');
          }
        }}
      >
        {captionUrl ? <track kind="captions" src={captionUrl} srcLang="en" label="Captions" default /> : null}
        Your browser cannot play this video. Use the transcript below.
      </video>
    </div>
  );
}
