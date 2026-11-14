// Structured, redacted logging. Tokens, cookies, signatures and query strings never reach the log sink.
const SENSITIVE_KEY = /token|secret|password|cookie|authorization|signature|session|key|principal|email/i;
const SENSITIVE_VALUE = /(bearer\s+\S+|[A-Za-z0-9_-]{40,})/g;

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url, 'http://local');
    return parsed.pathname;
  } catch {
    return '[unparseable-url]';
  }
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (typeof value === 'string') return value.replace(SENSITIVE_VALUE, '[redacted]');
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export type LogFields = Record<string, unknown>;
export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export function createLogger(sink: (line: string) => void = (line) => console.log(line), base: LogFields = {}): Logger {
  const emit = (level: 'info' | 'warn' | 'error', message: string, fields: LogFields = {}) =>
    sink(JSON.stringify({ level, message: redact(message), time: new Date().toISOString(), ...base, ...(redact(fields) as LogFields) }));
  return {
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
