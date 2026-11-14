import { describe, expect, it } from 'vitest';
import { ownerLoginPath } from './ownerLogin';

describe('ownerLoginPath', () => {
  it('accepts SWA login paths', () => {
    expect(ownerLoginPath('/.auth/login/github')).toBe('/.auth/login/github?post_login_redirect_uri=%2Fstudio');
    expect(ownerLoginPath(' /.auth/login/aad ')).toBe('/.auth/login/aad?post_login_redirect_uri=%2Fstudio');
  });
  it.each([undefined, '', 'https://evil.example/.auth/login/github', '/.auth/login/', '//evil', '/.auth/login/github/../x'])(
    'rejects %s',
    (value) => {
      expect(ownerLoginPath(value)).toBeNull();
    },
  );
});
