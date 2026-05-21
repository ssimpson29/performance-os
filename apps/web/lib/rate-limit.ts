/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Cold starts on Vercel serverless functions reset the in-memory state,
 * which means a burst right after a cold start can bypass an old limit.
 * That's acceptable for this workload — we're throttling a single athlete
 * to prevent accidental runaway spending, not preventing abuse from
 * distributed clients. For a stricter limiter, swap this module for
 * Vercel KV or Upstash Redis behind the same interface.
 *
 * Designed to be:
 * - Synchronous (no I/O on the hot path).
 * - Resettable for tests via resetRateLimitStore().
 * - Pure-ish: the only side effect is mutation of the module-local Map.
 */

const store = new Map<string, number[]>();

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number };

export type CheckRateLimitOptions = {
  /** Key to bucket on (typically `${userId}:${routeName}`). */
  key: string;
  /** Max calls allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Override for tests; defaults to Date.now(). */
  now?: () => number;
};

export function checkRateLimit(options: CheckRateLimitOptions): RateLimitResult {
  const now = (options.now ?? Date.now)();
  const cutoff = now - options.windowMs;

  const prior = store.get(options.key) ?? [];
  // Drop any timestamps older than the window.
  const fresh: number[] = [];
  for (const t of prior) {
    if (t > cutoff) fresh.push(t);
  }

  if (fresh.length >= options.limit) {
    const oldest = fresh[0];
    const retryAfterMs = options.windowMs - (now - oldest);
    // Save the trimmed list so we don't keep stale timestamps around forever.
    store.set(options.key, fresh);
    return { ok: false, retryAfterMs: Math.max(1, retryAfterMs) };
  }

  fresh.push(now);
  store.set(options.key, fresh);
  return { ok: true, remaining: options.limit - fresh.length };
}

/** Test-only: clear the entire in-memory store. */
export function resetRateLimitStore(): void {
  store.clear();
}
