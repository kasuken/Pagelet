import { describe, expect, it } from 'vitest';
import { clampResume } from './useProgress';

describe('clampResume', () => {
  it('bounds the position to 0–86400 whole seconds', () => {
    expect(clampResume(-5)).toBe(0);
    expect(clampResume(12.9)).toBe(12);
    expect(clampResume(100_000)).toBe(86_400);
    expect(clampResume(Number.NaN)).toBe(0);
  });
});
