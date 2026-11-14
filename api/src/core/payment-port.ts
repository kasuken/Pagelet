// Payment provider port. Production wires the Stripe SDK adapter (services/stripe.ts); tests supply fakes.

export interface CheckoutSessionSnapshot {
  id: string;
  mode: string;
  status: string | null;
  paymentStatus: string | null;
  currency: string | null;
  amountTotalMinor: number | null;
  clientReferenceId: string | null;
  paymentIntentId: string | null;
  customerEmail: string | null;
  createdUnix: number;
}

export interface CreateCheckoutInput {
  attemptId: string;
  email: string;
  currency: string;
  unitAmountMinor: number;
  productName: string;
  successUrl: string;
  cancelUrl: string;
  expiresAtUnix: number;
}

export interface VerifiedEvent {
  id: string;
  type: string;
  object: Record<string, unknown>;
}

export interface PaymentPort {
  /** Creates a payment-mode Checkout Session. The idempotency key makes retries return the same session. */
  createCheckoutSession(input: CreateCheckoutInput, idempotencyKey: string): Promise<{ id: string; url: string }>;
  /** Authoritative server-side read of a session. Never trust a browser return URL. */
  retrieveCheckoutSession(id: string): Promise<CheckoutSessionSnapshot>;
  /** Pages through completed sessions created since a time, for reconciliation. */
  listCheckoutSessions(input: { createdSinceUnix: number; startingAfter?: string; limit: number }): Promise<{ data: CheckoutSessionSnapshot[]; hasMore: boolean }>;
  /** Verifies the Stripe-Signature header against the raw bytes. Throws when the signature is invalid or stale. */
  verifyWebhook(rawBody: Buffer, signature: string): VerifiedEvent;
}
