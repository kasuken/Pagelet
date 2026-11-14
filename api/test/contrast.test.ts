import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance, checkAccent, parseHex } from '../src/services/contrast.js';

describe('WCAG contrast (real luminance, not approximations)', () => {
  it('matches the WCAG reference extremes', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6);
    expect(relativeLuminance('#000000')).toBe(0);
  });

  it('matches the known mid-grey boundary: #767676 is 4.54:1 on white', () => {
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  it('uses the linear segment for dark channels (the 0.04045 threshold)', () => {
    // #0A0A0A is below the threshold; the value must come from c/12.92, not the gamma formula.
    const lum = relativeLuminance('#0A0A0A');
    expect(lum).toBeCloseTo(0.2126 * (10 / 255 / 12.92) + 0.7152 * (10 / 255 / 12.92) + 0.0722 * (10 / 255 / 12.92), 9);
  });

  it('is symmetric and order independent', () => {
    expect(contrastRatio('#244ACC', '#FBFCFF')).toBeCloseTo(contrastRatio('#FBFCFF', '#244ACC'), 12);
  });

  it('accepts the default cobalt accent on white and Paper', () => {
    const check = checkAccent('#244ACC');
    expect(check.ok).toBe(true);
    expect(check.ratioOnWhite).toBeGreaterThanOrEqual(4.5);
    expect(check.ratioOnPaper).toBeGreaterThanOrEqual(4.5);
  });

  it('rejects light accents and accepts a dark one', () => {
    expect(checkAccent('#FFFF00').ok).toBe(false);
    expect(checkAccent('#E4DDFA').ok).toBe(false);
    expect(checkAccent('#0B3D91').ok).toBe(true);
  });

  it('rejects malformed colours', () => {
    expect(() => parseHex('#abc')).toThrow();
    expect(() => parseHex('blue')).toThrow();
  });
});
