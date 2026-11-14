// Mirrors LocalPath in @pagelet/contracts without importing its zod runtime into the bundle.
const LOCAL_PATH = /^\/(?!\/)[^\\\s]*$/;
export const DEFAULT_RETURN_TO = '/library';

/** Returns a same-origin path, or the default when the value could leave the site. */
export function safeReturnTo(value: unknown, fallback: string = DEFAULT_RETURN_TO): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) return fallback;
  if (!LOCAL_PATH.test(value)) return fallback;
  // Reject encoded tricks such as /%2F%2Fevil.example or /%5Cevil.example.
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (!LOCAL_PATH.test(decoded)) return fallback;
  if (/^\/account\/confirm(?:[/?#]|$)/.test(value)) return fallback;
  return value;
}
