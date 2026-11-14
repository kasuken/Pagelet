import { describe, expect, it, vi } from 'vitest';
import { readToken, stripTokenFromAddressBar } from './confirmToken';

const TOKEN = 'A'.repeat(20) + 'b_c-'.repeat(6);

describe('readToken', () => {
  it('returns a well-formed token and a URL without it', () => {
    const result = readToken(`https://shop.example/account/confirm?token=${TOKEN}&utm=x#top`);
    expect(result).toEqual({ token: TOKEN, cleanUrl: '/account/confirm?utm=x#top', hadToken: true });
  });

  it('rejects malformed tokens but still strips them', () => {
    const result = readToken('https://shop.example/account/confirm?token=short<script>');
    expect(result.token).toBeNull();
    expect(result.hadToken).toBe(true);
    expect(result.cleanUrl).toBe('/account/confirm');
  });

  it('handles a missing token', () => {
    expect(readToken('https://shop.example/account/confirm')).toEqual({
      token: null,
      cleanUrl: '/account/confirm',
      hadToken: false,
    });
  });
});

describe('stripTokenFromAddressBar', () => {
  it('replaces the URL and keeps the router history state', () => {
    const state = { usr: null, key: 'abc', idx: 3 };
    const replaceState = vi.fn();
    stripTokenFromAddressBar({
      location: { href: `https://shop.example/account/confirm?token=${TOKEN}` } as Location,
      history: { state, replaceState } as unknown as History,
    });
    expect(replaceState).toHaveBeenCalledWith(state, '', '/account/confirm');
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain(TOKEN);
  });

  it('does nothing when there is no token', () => {
    const replaceState = vi.fn();
    stripTokenFromAddressBar({
      location: { href: 'https://shop.example/account/confirm' } as Location,
      history: { state: null, replaceState } as unknown as History,
    });
    expect(replaceState).not.toHaveBeenCalled();
  });
});
