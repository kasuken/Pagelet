import type { ReactNode } from 'react';

export type NoticeTone = 'info' | 'success' | 'danger';

export interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  /** A reference users can quote to support. Rendered as part of the notice text. */
  requestId?: string;
  actions?: ReactNode;
  /** 'alert' interrupts screen readers; use it for failures caused by the user's action. */
  live?: 'polite' | 'assertive' | 'off';
  className?: string;
}

export function Notice({ tone = 'info', title, children, requestId, actions, live = 'polite', className }: NoticeProps) {
  const role = live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined;
  return (
    <div className={['notice', `notice--${tone}`, className].filter(Boolean).join(' ')} role={role}>
      {title ? <p className="notice__title">{title}</p> : null}
      {children ? <div className="notice__body">{children}</div> : null}
      {requestId ? (
        <p className="notice__reference">
          Reference: <span className="notice__request-id">{requestId}</span>
        </p>
      ) : null}
      {actions ? <div className="notice__actions">{actions}</div> : null}
    </div>
  );
}
