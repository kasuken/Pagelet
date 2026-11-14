import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api';
import { isStaleConflict, issuesByPath, slugify } from './common';

describe('studio helpers', () => {
  it('slugifies titles', () => {
    expect(slugify('  Café: My First Course! ')).toBe('cafe-my-first-course');
    expect(slugify('---')).toBe('');
  });
  it('detects stale-revision conflicts', () => {
    const stale = new ApiError({ status: 409, code: 'conflict', message: 'changed', requestId: 'r-12345678' });
    const slug = new ApiError({ status: 409, code: 'conflict', message: 'taken', requestId: 'r-12345678', issues: [{ path: 'slug', message: 'taken' }] });
    expect(isStaleConflict(stale)).toBe(true);
    expect(isStaleConflict(slug)).toBe(false);
    expect(issuesByPath(slug)).toEqual({ slug: 'taken' });
  });
  it('maps nested paths to their top-level field too', () => {
    const e = new ApiError({ status: 400, code: 'validation_failed', message: 'x', requestId: 'r-12345678', issues: [{ path: 'sellerDetails.contactEmail', message: 'Bad email' }] });
    expect(issuesByPath(e)).toEqual({ 'sellerDetails.contactEmail': 'Bad email', sellerDetails: 'Bad email' });
  });
});
