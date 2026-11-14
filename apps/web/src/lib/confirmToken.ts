const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;

export interface TokenReading {
  /** A well-formed token, or null when it is missing or malformed. */
  token: string | null;
  /** The same URL with the token parameter removed, relative to the origin. */
  cleanUrl: string;
  /** True when the URL contained a token parameter at all. */
  hadToken: boolean;
}

/** Pure: reads the sign-in token from a URL and returns the URL without it. */
export function readToken(href: string): TokenReading {
  const url = new URL(href, 'http://localhost');
  const raw = url.searchParams.get('token');
  url.searchParams.delete('token');
  const search = url.searchParams.toString();
  const cleanUrl = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
  return {
    token: raw !== null && TOKEN_PATTERN.test(raw) ? raw : null,
    cleanUrl,
    hadToken: raw !== null,
  };
}

/** Removes the token from the address bar, keeping the router's history state. */
export function stripTokenFromAddressBar(win: Pick<Window, 'location' | 'history'> = window): void {
  const { hadToken, cleanUrl } = readToken(win.location.href);
  if (hadToken) win.history.replaceState(win.history.state, '', cleanUrl);
}
