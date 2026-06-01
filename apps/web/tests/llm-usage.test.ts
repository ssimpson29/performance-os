import { describe, expect, it, vi } from 'vitest';

import {
  createUsageTracker,
  estimateCostUsd,
  logLlmUsage,
  pricingFor,
} from '../lib/agents/llm-usage';

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
