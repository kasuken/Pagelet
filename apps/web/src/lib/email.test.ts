import { describe, expect, it } from 'vitest';
import { validateEmail } from './email';

describe('validateEmail', () => {
  it('asks for an address when empty', () => {
    expect(validateEmail('   ')).toBe('Enter your email address.');
  });
  it.each(['name', 'name@', 'a b@c.de', 'name@host'])('rejects %s', (v) => {
    expect(validateEmail(v)).toMatch(/like name@example.com/);
  });
  it('accepts a normal address', () => {
    expect(validateEmail(' Name@Example.com ')).toBeUndefined();
  });
});
