import { describeError } from '../lib/api';
import { Button } from './Button';
import { Notice } from './Notice';

export function ErrorNotice({
  title,
  error,
  onRetry,
  retryLabel = 'Try again',
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const { message, requestId } = describeError(error);
  return (
    <Notice
      tone="danger"
      title={title}
      requestId={requestId}
      live="assertive"
      actions={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null
      }
    >
      <p>{message}</p>
    </Notice>
  );
}
