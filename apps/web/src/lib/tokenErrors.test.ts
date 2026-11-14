import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { tokenFailure } from './tokenErrors';

const err = (status: number, code: ConstructorParameters<typeof ApiError>[0]['code']) =>
  new ApiError({ status, code, message: 'x', requestId: 'r-12345678' });

describe('tokenFailure', () => {
  it('treats 401 as expired or already used', () => {
    expect(tokenFailure(err(401, 'unauthorized'))).toBe('expired');
  });
  it('treats 400 validation_failed as an incomplete link', () => {
    expect(tokenFailure(err(400, 'validation_failed'))).toBe('malformed');
  });
  it.each([
    [404, 'not_found'],
    [409, 'conflict'],
    [403, 'origin_rejected'],
    [500, 'internal_error'],
    [0, 'network_error'],
  ] as const)('treats %s %s as a retryable failure', (status, code) => {
    expect(tokenFailure(err(status, code))).toBe('other');
  });
  it('treats unknown throws as other', () => {
    expect(tokenFailure(new Error('x'))).toBe('other');
  });
});
