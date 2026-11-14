import type { MailMessage, MailPort } from '../core/ports.js';

export interface HttpMailOptions {
  url: string;
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}

/**
 * Generic HTTPS mail API adapter. Sends an Idempotency-Key header so provider retries cannot double-deliver.
 * Provider-specific settings (sender domain, DKIM/SPF) are documented in docs/OPERATIONS.md.
 */
export function createHttpMail(options: HttpMailOptions): MailPort {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async send(message: MailMessage, signal: AbortSignal) {
      const response = await doFetch(options.url, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!response.ok) throw new Error(`Mail provider returned HTTP ${response.status}`);
      const body = (await response.json().catch(() => ({}))) as { id?: unknown };
      return { providerMessageId: typeof body.id === 'string' ? body.id : null };
    },
  };
}

/**
 * Development transport. It prints messages, which may contain sign-in links, so it is refused on hosted
 * production (see deps.ts) and must never be configured in a deployed installation.
 */
export function createLogMail(sink: (line: string) => void = (line) => console.log(line)): MailPort {
  return {
    async send(message: MailMessage) {
      sink(`[dev-mail] to=${message.to} subject=${message.subject}\n${message.text}`);
      return { providerMessageId: null };
    },
  };
}
