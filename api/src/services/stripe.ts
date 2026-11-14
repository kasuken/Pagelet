import Stripe from 'stripe';
import type { CheckoutSessionSnapshot, CreateCheckoutInput, PaymentPort, VerifiedEvent } from '../core/payment-port.js';

export interface StripeOptions {
  secretKey: string;
  webhookSecret: string;
  /** Test seam; production uses the SDK's default HTTP client. */
  client?: Stripe;
}

function snapshotOf(session: Stripe.Checkout.Session): CheckoutSessionSnapshot {
  const pi = session.payment_intent;
  return {
    id: session.id,
    mode: session.mode,
    status: session.status ?? null,
    paymentStatus: session.payment_status ?? null,
    currency: session.currency ?? null,
    amountTotalMinor: session.amount_total ?? null,
    clientReferenceId: session.client_reference_id ?? null,
    paymentIntentId: typeof pi === 'string' ? pi : (pi?.id ?? null),
    customerEmail: session.customer_details?.email?.toLowerCase() ?? session.customer_email?.toLowerCase() ?? null,
    createdUnix: session.created,
  };
}

/** Stripe Checkout adapter. Prices are always sent from the server-side snapshot, never from the browser. */
export function createStripePayments(options: StripeOptions): PaymentPort {
  const stripe = options.client ?? new Stripe(options.secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  return {
    async createCheckoutSession(input: CreateCheckoutInput, idempotencyKey: string) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          customer_email: input.email,
          client_reference_id: input.attemptId,
          metadata: { checkout_attempt_id: input.attemptId },
          payment_intent_data: { metadata: { checkout_attempt_id: input.attemptId } },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: input.currency.toLowerCase(),
                unit_amount: input.unitAmountMinor,
                product_data: { name: input.productName },
              },
            },
          ],
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          expires_at: input.expiresAtUnix,
        },
        { idempotencyKey },
      );
      if (!session.url) throw new Error('Stripe did not return a Checkout URL');
      return { id: session.id, url: session.url };
    },
    async retrieveCheckoutSession(id: string) {
      return snapshotOf(await stripe.checkout.sessions.retrieve(id));
    },
    async listCheckoutSessions({ createdSinceUnix, startingAfter, limit }) {
      const page = await stripe.checkout.sessions.list({
        created: { gte: createdSinceUnix },
        limit,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      return { data: page.data.map(snapshotOf), hasMore: page.has_more };
    },
    verifyWebhook(rawBody: Buffer, signature: string): VerifiedEvent {
      const event = stripe.webhooks.constructEvent(rawBody, signature, options.webhookSecret);
      return { id: event.id, type: event.type, object: event.data.object as unknown as Record<string, unknown> };
    },
  };
}
