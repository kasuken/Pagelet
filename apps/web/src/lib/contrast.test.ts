import { describe, expect, it } from 'vitest';
import { contrastRatio, usableAccent } from './contrast';

describe('accent contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#244ACC', '#ffffff')).toBeGreaterThan(7);
  });
  it('accepts accessible accents and rejects weak or malformed ones', () => {
    expect(usableAccent('#244ACC')).toBe('#244acc');
    expect(usableAccent('#E4DDFA')).toBeNull();
    expect(usableAccent('red')).toBeNull();
    expect(usableAccent(null)).toBeNull();
  });
});
