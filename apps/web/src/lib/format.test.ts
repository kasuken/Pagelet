import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration } from './format';

describe('format helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB');
  });
  it('formats durations', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3723)).toBe('1:02:03');
  });
});
