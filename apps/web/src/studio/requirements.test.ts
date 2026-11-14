import { describe, expect, it } from 'vitest';
import { requirementLabel } from './requirements';

describe('requirementLabel', () => {
  it('maps known keys to plain language', () => {
    expect(requirementLabel('seller.legalName')).toBe('Seller legal name');
    expect(requirementLabel('taxMode')).toMatch(/Tax setting/);
  });
  it('shows unknown keys as they are', () => {
    expect(requirementLabel('future.key')).toBe('future.key');
  });
});
