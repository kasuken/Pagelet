/** Retryable: the webhook responds non-2xx and Stripe redelivers. Used for out-of-order and transient cases. */
export class RetryableError extends Error {
  readonly retryable = true;
}

/** Permanent mismatch: recorded for the owner, acknowledged so Stripe stops redelivering. */
export class MismatchError extends Error {
  readonly retryable = false;
}

export type HandleOutcome = 'fulfilled' | 'applied' | 'already_fulfilled' | 'duplicate_event' | 'ignored' | 'recorded_mismatch';
