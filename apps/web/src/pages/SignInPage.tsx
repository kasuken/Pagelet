import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { Field } from '../components/Field';
import { Surface } from '../components/Surface';
import { api, isApiError } from '../lib/api';
import { validateEmail } from '../lib/email';
import { safeReturnTo } from '../lib/returnTo';
import { useDocumentTitle } from '../lib/useDocumentTitle';

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'failed'; error: unknown };


export function SignInPage() {
  useDocumentTitle('Sign in');
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (status.kind === 'sent') resultRef.current?.focus();
  }, [status.kind]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateEmail(email);
    setFieldError(error);
    if (error) {
      inputRef.current?.focus();
      return;
    }
    setStatus({ kind: 'sending' });
    try {
      await api<unknown>('/api/auth/login-links', {
        method: 'POST',
        body: { email: email.trim(), returnTo },
      });
      setStatus({ kind: 'sent' });
    } catch (caught) {
      if (isApiError(caught) && caught.code === 'validation_failed') {
        const issue = caught.issues.find((i) => i.path === 'email');
        if (issue) {
          setFieldError('Enter an email address like name@example.com.');
          setStatus({ kind: 'idle' });
          inputRef.current?.focus();
          return;
        }
      }
      setStatus({ kind: 'failed', error: caught });
    }
  }

  function startOver() {
    setStatus({ kind: 'idle' });
    setEmail('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="narrow-page wrap">
      <Surface as="section" className="auth-panel" aria-labelledby="sign-in-title">
        {status.kind === 'sent' ? (
          <div className="auth-panel__result">
            <h1 id="sign-in-title" className="auth-panel__title" tabIndex={-1} ref={resultRef}>
              Check your email
            </h1>
            <p>
              If this address can be used here, we have sent a sign-in link to it. Open the link on this device and
              press <strong>Confirm sign-in</strong>. Each link works once.
            </p>
            <p className="auth-panel__hint">No email after a few minutes? Check your spam folder, then try again.</p>
            <Button variant="secondary" onClick={startOver}>
              Use a different email
            </Button>
          </div>
        ) : (
          <>
            <h1 id="sign-in-title" className="auth-panel__title">
              Sign in to your learning
            </h1>
            <p className="auth-panel__intro">
              Enter the email you used to buy. We will send you a link to open your purchases. There is no password.
            </p>
            <form className="auth-panel__form" onSubmit={handleSubmit} noValidate>
              <Field
                ref={inputRef}
                label="Email address"
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                required
                value={email}
                error={fieldError}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (fieldError) setFieldError(undefined);
                }}
              />
              <Button type="submit" busy={status.kind === 'sending'} busyLabel="Sending link…">
                Email me a sign-in link
              </Button>
            </form>
            {status.kind === 'failed' ? (
              <ErrorNotice title="We could not send the link" error={status.error} />
            ) : null}
          </>
        )}
      </Surface>
    </div>
  );
}
