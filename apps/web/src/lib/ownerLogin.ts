const OWNER_LOGIN = /^\/\.auth\/login\/[a-z0-9-]+$/i;

/** The configured SWA login path for the owner, or null when it is missing or not an SWA login path. */
export function ownerLoginPath(value: string | undefined = import.meta.env.VITE_OWNER_LOGIN_PATH): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !OWNER_LOGIN.test(trimmed)) return null;
  return `${trimmed}?post_login_redirect_uri=${encodeURIComponent('/studio')}`;
}
