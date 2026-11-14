import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/** Moves focus to <main> after client-side navigation so keyboard and screen-reader users start at the new content. */
export function useFocusMainOnNavigate() {
  const { pathname } = useLocation();
  // Compare with the previous pathname (not a "first run" flag) so StrictMode's
  // double effect on mount does not steal focus from the skip link on page load.
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    document.getElementById('main')?.focus();
  }, [pathname]);
}
