/**
 * LLM usage + cost instrumentation.
 *
 * OpenAI chat completions return a `usage` block (prompt/completion tokens).
 * This module accumulates it across a tool-calling loop and emits one
 * structured `[llm-usage]` log line per agent run, with an estimated USD cost.
 * Grep `[llm-usage]` in logs (or ship to an observability sink) to get
 * per-user, per-surface spend — the number that decides pricing.
 *
 * Pure: no I/O beyond the single console.log in logLlmUsage.
 */

export type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** Raw shape as returned by the OpenAI-compatible API. */
export type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

/** USD per 1,000,000 tokens. Extend as models are added. */
const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10 },
  'gpt-4.1': { inputPerM: 2.0, outputPerM: 8 },
  'gpt-4.1-mini': { inputPerM: 0.4, outputPerM: 1.6 },
  'gpt-4.1-nano': { inputPerM: 0.1, outputPerM: 0.4 },
};

// Unknown models bill at a deliberately high fallback so cost is never
// silently under-reported (better to over-estimate than miss a 4o-class spike).
const DEFAULT_PRICING = { inputPerM: 2.5, outputPerM: 10 };

export function pricingFor(model: string) {
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

export function estimateCostUsd(model: string, usage: LlmUsage): number {
  const p = pricingFor(model);
  return (usage.promptTokens * p.inputPerM + usage.completionTokens * p.outputPerM) / 1_000_000;
}

export type UsageTracker = {
  /** Fold in a response's usage block (no-op if absent). */
  add: (raw: RawUsage | null | undefined) => void;
  /** Count one LLM round-trip (whether or not it reported usage). */
  addIteration: () => void;
  readonly usage: LlmUsage;
  readonly iterations: number;
};

export function createUsageTracker(): UsageTracker {
  let promptTokens = 0;
  let completionTokens = 0;
  let iterations = 0;
  return {
    add(raw) {
      if (!raw) return;
      promptTokens += raw.prompt_tokens ?? 0;
      completionTokens += raw.completion_tokens ?? 0;
    },
    addIteration() {
      iterations += 1;
    },
    get usage() {
      return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
    },
    get iterations() {
      return iterations;
    },
  };
}

/**
 * Emit one structured usage line for an agent run. Returns the estimated cost
 * so a caller can additionally persist it (e.g. to the llm_usage table).
 */
export function logLlmUsage(args: {
  userId: string;
  surface: string;
  model: string;
  tracker: UsageTracker;
}): number {
  const { userId, surface, model, tracker } = args;
  const usage = tracker.usage;
  const costUsd = estimateCostUsd(model, usage);
  console.log(
    `[llm-usage] ${JSON.stringify({
      surface,
      userId,
      model,
      iterations: tracker.iterations,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      estCostUsd: Number(costUsd.toFixed(6)),
    })}`,
  );
  return costUsd;
}

// Minimal surface of the supabase client this module needs — keeps it
// decoupled + easy to stub in tests.
type SupabaseLike = { from: (table: string) => any };

/**
 * Best-effort insert of one usage row into public.llm_usage. Logged-and-ignored
 * on failure (e.g. migration 011 not yet applied) so it never breaks a coach
 * turn. Returns true on a successful write.
 */
export async function persistLlmUsage(
  supabase: SupabaseLike,
  args: { userId: string; surface: string; model: string; tracker: UsageTracker; costUsd: number },
): Promise<boolean> {
  const { userId, surface, model, tracker, costUsd } = args;
  const usage = tracker.usage;
  try {
    const res = await supabase.from('llm_usage').insert?.({
      user_id: userId,
      surface,
      model,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      iterations: tracker.iterations,
      est_cost_usd: Number(costUsd.toFixed(6)),
    });
    if (res?.error) {
      console.warn('[llm-usage] persist failed:', res.error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[llm-usage] persist threw:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Log the usage line AND persist it (when a supabase client is provided).
 * The single entry point agent loops should call at end-of-run.
 */
export async function recordLlmUsage(
  supabase: SupabaseLike | null | undefined,
  args: { userId: string; surface: string; model: string; tracker: UsageTracker },
): Promise<number> {
  const costUsd = logLlmUsage(args);
  if (supabase) await persistLlmUsage(supabase, { ...args, costUsd });
  return costUsd;
}

/** UTC start-of-day ISO for `now`. */
function startOfUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/** Sum of est_cost_usd for the athlete since UTC midnight. 0 on any error. */
export async function getTodaySpendUsd(
  supabase: SupabaseLike,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('llm_usage')
      .select('est_cost_usd')
      .eq('user_id', userId)
      .gte('created_at', startOfUtcDay(now));
    if (error) return 0;
    return ((data as Array<{ est_cost_usd: number | string | null }> | null) ?? []).reduce(
      (sum, r) => sum + Number(r.est_cost_usd ?? 0),
      0,
    );
  } catch {
    return 0;
  }
}

/** Daily per-user USD ceiling, or null when disabled (env unset / invalid). */
export function dailyCeilingUsd(): number | null {
  const raw = Number(process.env.AI_COACH_DAILY_USD_CEILING);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Check whether the athlete is under their daily spend ceiling. When no
 * ceiling is configured this always allows (ceilingUsd: null) — opt-in only,
 * so it never blocks until you set AI_COACH_DAILY_USD_CEILING.
 */
export async function checkSpendCeiling(
  supabase: SupabaseLike,
  userId: string,
  now: Date = new Date(),
): Promise<{ allowed: boolean; spentUsd: number; ceilingUsd: number | null }> {
  const ceilingUsd = dailyCeilingUsd();
  if (ceilingUsd === null) return { allowed: true, spentUsd: 0, ceilingUsd: null };
  const spentUsd = await getTodaySpendUsd(supabase, userId, now);
  return { allowed: spentUsd < ceilingUsd, spentUsd, ceilingUsd };
}
