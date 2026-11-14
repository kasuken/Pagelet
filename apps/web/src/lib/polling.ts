/** Delays between checkout status checks: quick at first, then slower. Total stays near 90 seconds. */
export const POLL_DELAYS_MS: readonly number[] = [1500, 2000, 3000, 4000, 5000, 7000, 9000, 12000, 15000, 15000, 15000];

export function pollDelay(attempt: number): number | null {
  return attempt < POLL_DELAYS_MS.length ? (POLL_DELAYS_MS[attempt] ?? null) : null;
}

export function totalPollBudgetMs(): number {
  return POLL_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
}
