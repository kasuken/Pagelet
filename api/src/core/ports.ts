// Ports: external services are reached only through these interfaces. Tests supply fakes; production wires SDK adapters.

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Provider idempotency key. The same key must not produce two deliveries. */
  idempotencyKey: string;
}

export interface MailPort {
  send(message: MailMessage, signal: AbortSignal): Promise<{ providerMessageId: string | null }>;
}

export interface BlobPort {
  /** Returns a short-lived, single-blob upload URL. Never container-wide. */
  issueUploadUrl(objectKey: string, expiresInSeconds: number, contentType: string, maxBytes: number): Promise<string>;
  /** Returns a short-lived read URL for a single private object. */
  issueReadUrl(objectKey: string, expiresInSeconds: number, downloadName: string): Promise<string>;
  /** Verifies the stored object's size and content type. Returns null when the object does not exist. */
  inspect(objectKey: string): Promise<{ bytes: number; contentType: string } | null>;
  /** Reads the first `bytes` of a private object, server-side only, for magic-number and WebVTT header checks. */
  readHead(objectKey: string, bytes: number): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
}

export interface PublishPort {
  /** Triggers a static rebuild with a server-held credential. Must be idempotent for the given key. */
  triggerBuild(input: { idempotencyKey: string; publicationId: string }, signal: AbortSignal): Promise<{ runUrl: string | null }>;
}
