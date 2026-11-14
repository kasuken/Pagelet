import { describe, expect, it } from 'vitest';
import { pollDelay, totalPollBudgetMs, POLL_DELAYS_MS } from './polling';

describe('checkout polling schedule', () => {
  it('backs off and never shrinks', () => {
    for (let i = 1; i < POLL_DELAYS_MS.length; i++) {
      expect(POLL_DELAYS_MS[i]!).toBeGreaterThanOrEqual(POLL_DELAYS_MS[i - 1]!);
    }
  });
  it('is bounded to about 90 seconds and then stops', () => {
    expect(totalPollBudgetMs()).toBeLessThanOrEqual(90_000);
    expect(totalPollBudgetMs()).toBeGreaterThanOrEqual(60_000);
    expect(pollDelay(POLL_DELAYS_MS.length)).toBeNull();
    expect(pollDelay(0)).toBe(1500);
  });
});
