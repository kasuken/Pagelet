import type { MoneyValue } from './types';

/** Formats integer minor units using the currency's own number of decimals (JPY has none). */
export function formatMoney(money: MoneyValue, locale?: string): string {
  try {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(money.amountMinor / 10 ** digits);
  } catch {
    return `${(money.amountMinor / 100).toFixed(2)} ${money.currency}`;
  }
}

export function isFree(money: MoneyValue): boolean {
  return money.amountMinor === 0;
}

export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Minor units to an editable decimal string, for example 4900 EUR -> "49.00". */
export function minorToDecimal(amountMinor: number, currency: string): string {
  const digits = currencyDigits(currency);
  return (amountMinor / 10 ** digits).toFixed(digits);
}

/**
 * Parses a typed price ("49", "49.5", "49,50") into integer minor units.
 * Returns null when the text is not a valid non-negative amount for the currency.
 */
export function decimalToMinor(text: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const normalized = text.trim().replace(/\s/g, '').replace(',', '.');
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`);
  if (!pattern.test(normalized)) return null;
  const [whole = '0', fraction = ''] = normalized.split('.');
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  return Number.isSafeInteger(minor) && minor <= 100_000_000 ? minor : null;
}
