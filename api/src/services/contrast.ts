// WCAG 2.2 relative luminance and contrast ratio, computed from sRGB channels (not approximations).

export const PAPER_HEX = '#FBFCFF';
export const WHITE_HEX = '#FFFFFF';
/** WCAG AA for normal text and for white labels on a brand-coloured control. */
export const AA_NORMAL_TEXT = 4.5;

function channelToLinear(value8bit: number): number {
  const c = value8bit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex);
  if (!m) throw new Error(`Not a six-digit hex colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(channelToLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface AccentCheck {
  ok: boolean;
  ratioOnWhite: number;
  ratioOnPaper: number;
  minimum: number;
}

/** An accent must reach AA normal-text contrast on both the white surface and the Paper canvas. */
export function checkAccent(hex: string): AccentCheck {
  const ratioOnWhite = Math.round(contrastRatio(hex, WHITE_HEX) * 100) / 100;
  const ratioOnPaper = Math.round(contrastRatio(hex, PAPER_HEX) * 100) / 100;
  return {
    ok: ratioOnWhite >= AA_NORMAL_TEXT && ratioOnPaper >= AA_NORMAL_TEXT,
    ratioOnWhite,
    ratioOnPaper,
    minimum: AA_NORMAL_TEXT,
  };
}
