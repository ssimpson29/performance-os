import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkSpendCeiling,
  createUsageTracker,
  estimateCostUsd,
  getTodaySpendUsd,
  logLlmUsage,
  persistLlmUsage,
  pricingFor,
} from '../lib/agents/llm-usage';

// Combined builder: supports from().insert(row) AND from().select().eq().gte().
function makeSupabase(opts: {
  selectData?: Array<{ est_cost_usd: number | string | null }>;
  selectError?: { message: string } | null;
  insertError?: { message: string } | null;
  onInsert?: (row: Record<string, unknown>) => void;
} = {}) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.gte = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: opts.selectData ?? [], error: opts.selectError ?? null });
  builder.insert = (row: Record<string, unknown>) => {
    opts.onInsert?.(row);
    return Promise.resolve({ error: opts.insertError ?? null });
  };
  return { from: () => builder } as never;
}

const trackerWith = (prompt: number, completion: number, iters = 1) => {
  const t = createUsageTracker();
  for (let i = 0; i < iters; i += 1) t.addIteration();
  t.add({ prompt_tokens: prompt, completion_tokens: completion });
  return t;
};

describe('estimateCostUsd', () => {
  it('prices gpt-4o-mini per the published rate', () => {
    // 1M input @ $0.15 + 1M output @ $0.60 = $0.75
    expect(estimateCostUsd('gpt-4o-mini', { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 })).toBeCloseTo(0.75, 6);
  });

  it('prices gpt-4o ~16x the mini for the same tokens', () => {
    const mini = estimateCostUsd('gpt-4o-mini', { promptTokens: 20_000, completionTokens: 900, totalTokens: 20_900 });
    const full = estimateCostUsd('gpt-4o', { promptTokens: 20_000, completionTokens: 900, totalTokens: 20_900 });
    expect(full / mini).toBeGreaterThan(10);
  });

  it('falls back to a high default for unknown models (never under-reports)', () => {
    expect(pricingFor('some-future-model')).toEqual(pricingFor('gpt-4o')); // default == 4o-tier
  });
});

describe('createUsageTracker', () => {
  it('accumulates prompt/completion tokens and iterations, tolerates missing usage', () => {
    const t = createUsageTracker();
    t.addIteration();
    t.add({ prompt_tokens: 5000, completion_tokens: 200, total_tokens: 5200 });
    t.addIteration();
    t.add(undefined); // a round that returned no usage block
    t.addIteration();
    t.add({ prompt_tokens: 8000, completion_tokens: 300 });

    expect(t.iterations).toBe(3);
    expect(t.usage).toEqual({ promptTokens: 13000, completionTokens: 500, totalTokens: 13500 });
  });
});

describe('logLlmUsage', () => {
  it('logs one structured [llm-usage] line and returns the cost', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const t = createUsageTracker();
    t.addIteration();
    t.add({ prompt_tokens: 20_000, completion_tokens: 900 });

    const cost = logLlmUsage({ userId: 'u1', surface: 'coach-chat', model: 'gpt-4o-mini', tracker: t });

    expect(cost).toBeCloseTo((20_000 * 0.15 + 900 * 0.6) / 1_000_000, 8);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0] as string;
    expect(line).toContain('[llm-usage]');
    const json = JSON.parse(line.replace('[llm-usage] ', ''));
    expect(json).toMatchObject({ surface: 'coach-chat', userId: 'u1', model: 'gpt-4o-mini', iterations: 1, totalTokens: 20_900 });
    spy.mockRestore();
  });
});

describe('persistLlmUsage', () => {
  it('inserts a row with token counts + est cost and returns true', async () => {
    let inserted: Record<string, unknown> | null = null;
    const supabase = makeSupabase({ onInsert: (r) => (inserted = r) });
    const ok = await persistLlmUsage(supabase, {
      userId: 'u1',
      surface: 'coach-chat',
      model: 'gpt-4o-mini',
      tracker: trackerWith(20_000, 900, 3),
      costUsd: 0.00354,
    });
    expect(ok).toBe(true);
    expect(inserted).toMatchObject({
      user_id: 'u1',
      surface: 'coach-chat',
      model: 'gpt-4o-mini',
      prompt_tokens: 20_000,
      completion_tokens: 900,
      total_tokens: 20_900,
      iterations: 3,
      est_cost_usd: 0.00354,
    });
  });

  it('returns false (best-effort) when the insert errors — e.g. table missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const supabase = makeSupabase({ insertError: { message: 'relation "llm_usage" does not exist' } });
    const ok = await persistLlmUsage(supabase, {
      userId: 'u1', surface: 'coach-chat', model: 'gpt-4o-mini', tracker: trackerWith(1, 1), costUsd: 0,
    });
    expect(ok).toBe(false);
    warn.mockRestore();
  });
});

describe('getTodaySpendUsd', () => {
  it('sums est_cost_usd rows for the day', async () => {
    const supabase = makeSupabase({ selectData: [{ est_cost_usd: 0.12 }, { est_cost_usd: '0.08' }, { est_cost_usd: null }] });
    expect(await getTodaySpendUsd(supabase, 'u1')).toBeCloseTo(0.2, 6);
  });

  it('returns 0 on query error', async () => {
    const supabase = makeSupabase({ selectError: { message: 'boom' } });
    expect(await getTodaySpendUsd(supabase, 'u1')).toBe(0);
  });
});

describe('checkSpendCeiling', () => {
  const saved = process.env.AI_COACH_DAILY_USD_CEILING;
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_COACH_DAILY_USD_CEILING;
    else process.env.AI_COACH_DAILY_USD_CEILING = saved;
  });

  it('always allows (and never queries) when no ceiling is configured', async () => {
    delete process.env.AI_COACH_DAILY_USD_CEILING;
    const res = await checkSpendCeiling(makeSupabase({ selectData: [{ est_cost_usd: 999 }] }), 'u1');
    expect(res).toEqual({ allowed: true, spentUsd: 0, ceilingUsd: null });
  });

  it('allows while under the ceiling and blocks once at/over it', async () => {
    process.env.AI_COACH_DAILY_USD_CEILING = '1.00';
    const under = await checkSpendCeiling(makeSupabase({ selectData: [{ est_cost_usd: 0.4 }] }), 'u1');
    expect(under.allowed).toBe(true);
    expect(under.spentUsd).toBeCloseTo(0.4, 6);

    const over = await checkSpendCeiling(makeSupabase({ selectData: [{ est_cost_usd: 1.2 }] }), 'u1');
    expect(over.allowed).toBe(false);
    expect(over.ceilingUsd).toBe(1);
  });
});
