import type { MailMessage } from '../core/ports.js';

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Accessible sign-in email: a plain-text variant, an HTML variant with a real link, and no tracking pixels. */
export function loginLinkMessage(input: { to: string; link: string; shopName: string; expiresMinutes: number; idempotencyKey: string }): MailMessage {
  const subject = `Your sign-in link for ${input.shopName}`;
  const text = [
    `Use this link to sign in to ${input.shopName}:`,
    input.link,
    '',
    `The link works once and expires in ${input.expiresMinutes} minutes.`,
    'If you did not ask for it, you can ignore this message.',
  ].join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(subject)}</title></head>
<body><main><h1>Sign in to ${escape(input.shopName)}</h1>
<p><a href="${escape(input.link)}">Sign in</a></p>
<p>The link works once and expires in ${input.expiresMinutes} minutes. If you did not ask for it, you can ignore this message.</p>
</main></body></html>`;
  return { to: input.to, subject, text, html, idempotencyKey: input.idempotencyKey };
}

/** Purchase access email. Contains the library address only; never a download or video URL. */
export function purchaseAccessMessage(input: {
  to: string;
  shopName: string;
  productTitle: string;
  libraryUrl: string;
  idempotencyKey: string;
}): MailMessage {
  const subject = `Your access to ${input.productTitle}`;
  const text = [
    `Thanks for buying ${input.productTitle} from ${input.shopName}.`,
    `Open your library to start: ${input.libraryUrl}`,
    'Sign in with this email address to see your purchases.',
  ].join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(subject)}</title></head>
<body><main><h1>Your access is ready</h1>
<p>Thanks for buying <strong>${escape(input.productTitle)}</strong> from ${escape(input.shopName)}.</p>
<p><a href="${escape(input.libraryUrl)}">Open your library</a></p>
<p>Sign in with this email address to see your purchases.</p>
</main></body></html>`;
  return { to: input.to, subject, text, html, idempotencyKey: input.idempotencyKey };
}

/** Refund/revocation notice: states the outcome plainly and explains what remains available. */
export function accessChangedMessage(input: {
  to: string;
  shopName: string;
  productTitle: string;
  outcome: 'revoked' | 'restored' | 'suspended';
  idempotencyKey: string;
}): MailMessage {
  const phrase = {
    revoked: 'Your access has been removed after a refund.',
    restored: 'Your access has been restored.',
    suspended: 'Your access is paused while a payment dispute is open.',
  }[input.outcome];
  const subject = `Access update for ${input.productTitle}`;
  const text = `${phrase}\n\nProduct: ${input.productTitle}\nShop: ${input.shopName}\n`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(subject)}</title></head>
<body><main><h1>Access update</h1><p>${escape(phrase)}</p><p>Product: ${escape(input.productTitle)}</p><p>Shop: ${escape(input.shopName)}</p></main></body></html>`;
  return { to: input.to, subject, text, html, idempotencyKey: input.idempotencyKey };
}

/** Free-product claim: the link proves control of the address before a free grant is recorded. */
export function freeClaimMessage(input: {
  to: string;
  shopName: string;
  productTitle: string;
  link: string;
  expiresMinutes: number;
  idempotencyKey: string;
}): MailMessage {
  const subject = `Confirm your free copy of ${input.productTitle}`;
  const text = [
    `Confirm your email to add ${input.productTitle} from ${input.shopName} to your library:`,
    input.link,
    '',
    `The link works once and expires in ${input.expiresMinutes} minutes.`,
  ].join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(subject)}</title></head>
<body><main><h1>Confirm your free copy</h1><p>Add <strong>${escape(input.productTitle)}</strong> from ${escape(input.shopName)} to your library.</p>
<p><a href="${escape(input.link)}">Confirm and add to library</a></p>
<p>The link works once and expires in ${input.expiresMinutes} minutes.</p></main></body></html>`;
  return { to: input.to, subject, text, html, idempotencyKey: input.idempotencyKey };
}
