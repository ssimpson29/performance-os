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
 * so a caller can additionally persist it (e.g. to an llm_usage table) later.
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
