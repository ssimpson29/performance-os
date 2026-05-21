import { beforeEach, describe, expect, it } from 'vitest';

import { checkRateLimit, resetRateLimitStore } from '../lib/rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it('allows calls under the limit and reports remaining', () => {
    const a = checkRateLimit({ key: 'k', limit: 3, windowMs: 60_000, now: () => 1000 });
    const b = checkRateLimit({ key: 'k', limit: 3, windowMs: 60_000, now: () => 2000 });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok) expect(a.remaining).toBe(2);
    if (b.ok) expect(b.remaining).toBe(1);
  });

  it('returns ok:false with retryAfterMs once the limit is hit', () => {
    checkRateLimit({ key: 'k', limit: 2, windowMs: 60_000, now: () => 1000 });
    checkRateLimit({ key: 'k', limit: 2, windowMs: 60_000, now: () => 2000 });
    const third = checkRateLimit({ key: 'k', limit: 2, windowMs: 60_000, now: () => 3000 });
    expect(third.ok).toBe(false);
    if (!third.ok) {
      // The oldest in-window call was at t=1000; window is 60s; now=3000.
      // retryAfterMs = 60000 - (3000 - 1000) = 58000.
      expect(third.retryAfterMs).toBe(58_000);
    }
  });

  it('lets calls back in after the window slides past the oldest', () => {
    checkRateLimit({ key: 'k', limit: 2, windowMs: 1_000, now: () => 100 });
    checkRateLimit({ key: 'k', limit: 2, windowMs: 1_000, now: () => 200 });
    // 200ms later we're still inside the window for both calls → reject.
    const reject = checkRateLimit({ key: 'k', limit: 2, windowMs: 1_000, now: () => 400 });
    expect(reject.ok).toBe(false);
    // Now jump past the window from the FIRST call (which was at t=100).
    const ok = checkRateLimit({ key: 'k', limit: 2, windowMs: 1_000, now: () => 1300 });
    expect(ok.ok).toBe(true);
  });

  it('buckets independent keys separately', () => {
    checkRateLimit({ key: 'a', limit: 1, windowMs: 60_000, now: () => 1000 });
    checkRateLimit({ key: 'b', limit: 1, windowMs: 60_000, now: () => 1000 });
    const aSecond = checkRateLimit({ key: 'a', limit: 1, windowMs: 60_000, now: () => 1500 });
    const bSecond = checkRateLimit({ key: 'b', limit: 1, windowMs: 60_000, now: () => 1500 });
    expect(aSecond.ok).toBe(false);
    expect(bSecond.ok).toBe(false);
    // But key 'c' is fresh.
    const cFirst = checkRateLimit({ key: 'c', limit: 1, windowMs: 60_000, now: () => 1500 });
    expect(cFirst.ok).toBe(true);
  });

  it('handles back-to-back over-limit cleanly (no retryAfterMs of 0)', () => {
    checkRateLimit({ key: 'k', limit: 1, windowMs: 60_000, now: () => 1000 });
    const denied = checkRateLimit({ key: 'k', limit: 1, windowMs: 60_000, now: () => 60_000 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.retryAfterMs).toBeGreaterThan(0);
  });
});
