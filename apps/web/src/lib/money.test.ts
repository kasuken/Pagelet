import { describe, expect, it } from 'vitest';
import { formatMoney, isFree } from './money';

describe('formatMoney', () => {
  it('uses two decimals for EUR and USD', () => {
    expect(formatMoney({ amountMinor: 4900, currency: 'EUR' }, 'en-GB')).toBe('€49.00');
    expect(formatMoney({ amountMinor: 1250, currency: 'USD' }, 'en-US')).toBe('$12.50');
  });
  it('uses no decimals for JPY', () => {
    expect(formatMoney({ amountMinor: 1200, currency: 'JPY' }, 'en-US')).toBe('¥1,200');
  });
  it('falls back for unknown currencies', () => {
    expect(formatMoney({ amountMinor: 100, currency: 'X' }, 'en-US')).toBe('1.00 X');
  });
  it('detects free products', () => {
    expect(isFree({ amountMinor: 0, currency: 'EUR' })).toBe(true);
    expect(isFree({ amountMinor: 1, currency: 'EUR' })).toBe(false);
  });
});

import { decimalToMinor, minorToDecimal } from './money';

describe('price editing', () => {
  it('round-trips decimals for EUR and JPY', () => {
    expect(minorToDecimal(4900, 'EUR')).toBe('49.00');
    expect(minorToDecimal(1200, 'JPY')).toBe('1200');
    expect(decimalToMinor('49', 'EUR')).toBe(4900);
    expect(decimalToMinor('49,5', 'EUR')).toBe(4950);
    expect(decimalToMinor('0.07', 'EUR')).toBe(7);
    expect(decimalToMinor('1200', 'JPY')).toBe(1200);
  });
  it('rejects invalid amounts', () => {
    for (const bad of ['', '-1', '1.234', 'abc', '12.5', '1e3']) {
      expect(decimalToMinor(bad, bad === '12.5' ? 'JPY' : 'EUR')).toBeNull();
    }
    expect(decimalToMinor('1000001', 'EUR')).toBeNull();
  });
});
