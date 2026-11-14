/** The Pagelet page-with-fold mark. Decorative: always paired with a visible name. */
export function BrandMark() {
  return (
    <svg className="brand-mark" width="26" height="30" viewBox="0 0 30 34" aria-hidden="true" focusable="false">
      <path className="brand-mark__sheet" d="M2 3h17l9 9v19H2z" />
      <path className="brand-mark__lines" d="M19 3v9h9M9 18h12M9 24h8" fill="none" strokeWidth="2" />
    </svg>
  );
}
