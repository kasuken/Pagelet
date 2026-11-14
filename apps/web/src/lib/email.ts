const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Enter your email address.';
  if (trimmed.length > 254 || !EMAIL_SHAPE.test(trimmed)) return 'Enter an email address like name@example.com.';
  return undefined;
}
