import { useEffect, useState, type ReactNode } from 'react';
import { Button, LinkButton } from './Button';
import { ErrorNotice } from './ErrorNotice';
import { Notice } from './Notice';
import { Surface } from './Surface';
import { describeError } from '../lib/api';
import { readToken, stripTokenFromAddressBar } from '../lib/confirmToken';
import { tokenFailure } from '../lib/tokenErrors';

type Status = { kind: 'ready' } | { kind: 'working' } | { kind: 'failed'; error: unknown };

export interface TokenActionPageProps {
  title: string;
  intro: string;
  actionLabel: string;
  busyLabel: string;
  failureTitle: string;
  newLinkTo: string;
  newLinkLabel: string;
  /** Runs only after an explicit button press. Throws on failure. */
  onConfirm: (token: string) => Promise<void>;
  /** Rendered instead of the form once onConfirm has finished, when the page stays on screen. */
  done?: ReactNode;
}

/**
 * Shared flow for single-use email links: read the token once, strip it from the address bar,
 * and consume it only when the person presses the button.
 */
export function TokenActionPage(props: TokenActionPageProps) {
  const [token] = useState(() => readToken(window.location.href).token);
  const [status, setStatus] = useState<Status>({ kind: 'ready' });

  useEffect(() => {
    stripTokenFromAddressBar();
  }, []);

  async function confirm() {
    if (!token || status.kind === 'working') return;
    setStatus({ kind: 'working' });
    try {
      await props.onConfirm(token);
      setStatus({ kind: 'ready' });
    } catch (error) {
      setStatus({ kind: 'failed', error });
    }
  }

  const failure = status.kind === 'failed' ? tokenFailure(status.error) : null;
  const newLink = <LinkButton to={props.newLinkTo}>{props.newLinkLabel}</LinkButton>;

  let body: ReactNode;
  if (props.done) {
    body = props.done;
  } else if (!token || failure === 'malformed') {
    body = (
      <Notice
        tone="danger"
        title="This link is incomplete"
        requestId={failure ? describeError(status.kind === 'failed' ? status.error : null).requestId : undefined}
        live={failure ? 'assertive' : 'polite'}
        actions={newLink}
      >
        <p>Open the link from your email again. If it still does not work, request a new one.</p>
      </Notice>
    );
  } else if (failure === 'expired') {
    body = (
      <Notice
        tone="danger"
        title="This link has expired or was already used"
        requestId={status.kind === 'failed' ? describeError(status.error).requestId : undefined}
        live="assertive"
        actions={newLink}
      >
        <p>Each link works once and only for a short time. Request a new link to continue.</p>
      </Notice>
    );
  } else {
    body = (
      <>
        <p className="auth-panel__intro">{props.intro}</p>
        <Button busy={status.kind === 'working'} busyLabel={props.busyLabel} onClick={confirm}>
          {props.actionLabel}
        </Button>
        {status.kind === 'failed' ? (
          <ErrorNotice title={props.failureTitle} error={status.error} onRetry={confirm} />
        ) : null}
      </>
    );
  }

  return (
    <div className="narrow-page wrap">
      <Surface as="section" className="auth-panel" aria-labelledby="token-action-title">
        <h1 id="token-action-title" className="auth-panel__title">
          {props.title}
        </h1>
        {body}
      </Surface>
    </div>
  );
}
