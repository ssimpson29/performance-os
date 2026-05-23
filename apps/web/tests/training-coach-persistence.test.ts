import { describe, expect, it, vi } from 'vitest';

import { loadTrainingCoachState, persistTrainingCoachRun } from '../lib/agents/training-coach-persistence';
import type { TrainingCoachOutput } from '../lib/agents/training-coach';

type CapturedCall = { table: string; method: string; payload?: unknown; filters: Record<string, unknown> };

function buildFakeSupabase(opts: {
  existingSummaryRow?: { id: string; summary: Record<string, unknown> | null; training_recommendation: string | null };
  insertedSummaryId?: string;
  loadError?: { message: string };
}) {
  const calls: CapturedCall[] = [];

  type ChainKey = 'select' | 'eq' | 'limit' | 'order' | 'update' | 'insert' | 'gte' | 'lte';
  const makeChain = (
    table: string,
    method: string,
    payload?: unknown,
  ): Record<ChainKey, unknown> & { then?: unknown } => {
    const call: CapturedCall = { table, method, payload, filters: {} };
    calls.push(call);

    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'limit', 'order', 'gte', 'lte'] as ChainKey[]) {
      chain[m] = (...args: unknown[]) => {
        if (m === 'eq' && typeof args[0] === 'string') {
          call.filters[args[0] as string] = args[1];
        }
        return chain;
      };
    }
    chain.single = async () => ({ data: { id: opts.insertedSummaryId ?? 'new-id' }, error: null });

    // Resolution behavior depends on table + method:
    chain.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
      if (opts.loadError && table === 'daily_summaries' && method === 'select') {
        resolve({ data: null, error: opts.loadError });
        return;
      }
      if (table === 'daily_summaries' && method === 'select') {
        const data = opts.existingSummaryRow ? [opts.existingSummaryRow] : [];
        resolve({ data, error: null });
        return;
      }
      // update/insert/health_events insert all resolve fine by default
      resolve({ data: null, error: null });
    };

    return chain as Record<ChainKey, unknown> & { then: unknown };
  };

  const supabase = {
    from: (table: string) => ({
      select: (...args: unknown[]) => makeChain(table, 'select', args),
      update: (payload: unknown) => makeChain(table, 'update', payload),
      insert: (payload: unknown) => makeChain(table, 'insert', payload),
    }),
  } as unknown as Parameters<typeof persistTrainingCoachRun>[0];

  return { supabase, calls };
}

const sampleOutput = (): TrainingCoachOutput => ({
  message: 'Easy run today. Watch the foot.',
  recommendations: ['Monday: Aerobic Run — base'],
  cautions: ['Recovery trend is degrading'],
  rationale: 'Fatigue: manageable. Recovery: degrading.',
  conversation: [
    { role: 'athlete', text: 'foot hurts', at: '2026-05-21T12:00:00.000Z' },
    { role: 'coach', text: 'Easy run today. Watch the foot.', at: '2026-05-21T12:00:01.000Z' },
  ],
  followUp: {
    easyThroughDate: '2026-05-24',
    checkInDate: '2026-05-25',
    status: 'active',
    bodyPart: 'foot',
  },
  injurySignal: { detected: true, bodyPart: 'foot', rationale: 'matched pattern' },
  recoverySignal: { detected: false, rationale: 'no positive phrase' },
  llmInvoked: false,
  toolTrace: [],
  planCommitted: false,
});

describe('persistTrainingCoachRun', () => {
  it('inserts a new daily_summaries row when none exists', async () => {
    const { supabase, calls } = buildFakeSupabase({ insertedSummaryId: 'fresh-id' });
    const result = await persistTrainingCoachRun(supabase, {
      userId: 'user-1',
      today: '2026-05-21',
      output: sampleOutput(),
    });

    expect(result.summaryId).toBe('fresh-id');
    expect(result.healthEventInserted).toBe(true);

    const insertCall = calls.find((c) => c.table === 'daily_summaries' && c.method === 'insert');
    expect(insertCall, 'daily_summaries insert call').toBeDefined();
    const payload = insertCall!.payload as { summary: Record<string, unknown>; training_recommendation: string };
    expect(payload.training_recommendation).toBe('Easy run today. Watch the foot.');
    expect(payload.summary.coachFollowUp).toMatchObject({ status: 'active', bodyPart: 'foot' });
    expect(payload.summary.coachConversation).toHaveLength(2);

    const healthInsert = calls.find((c) => c.table === 'health_events' && c.method === 'insert');
    expect(healthInsert, 'health_events insert call').toBeDefined();
    const hePayload = healthInsert!.payload as { event_type: string; metadata: { source: string; bodyPart?: string } };
    expect(hePayload.event_type).toBe('injury');
    expect(hePayload.metadata.source).toBe('coach_message');
    expect(hePayload.metadata.bodyPart).toBe('foot');
  });

  it('updates the existing daily_summaries row and merges without clobbering other summary keys', async () => {
    const { supabase, calls } = buildFakeSupabase({
      existingSummaryRow: {
        id: 'existing-id',
        summary: {
          longevityContext: { recoveryPriority: 'elevated' },
          someOtherKey: 'preserved',
        },
        training_recommendation: 'old value',
      },
    });

    const output = sampleOutput();
    output.injurySignal = { detected: false, rationale: 'no injury' };
    output.followUp = null;

    const result = await persistTrainingCoachRun(supabase, {
      userId: 'user-1',
      today: '2026-05-21',
      output,
    });

    expect(result.summaryId).toBe('existing-id');
    expect(result.healthEventInserted).toBe(false);

    const updateCall = calls.find((c) => c.table === 'daily_summaries' && c.method === 'update');
    expect(updateCall, 'daily_summaries update call').toBeDefined();
    const payload = updateCall!.payload as { summary: Record<string, unknown> };
    // Preserves other keys
    expect(payload.summary.longevityContext).toEqual({ recoveryPriority: 'elevated' });
    expect(payload.summary.someOtherKey).toBe('preserved');
    // Updates coach keys
    expect(payload.summary.coachConversation).toHaveLength(2);
    expect(payload.summary.coachFollowUp).toBeNull();
  });

  it('throws when the daily_summaries load query errors', async () => {
    const { supabase } = buildFakeSupabase({ loadError: { message: 'permission denied' } });
    await expect(
      persistTrainingCoachRun(supabase, { userId: 'user-1', today: '2026-05-21', output: sampleOutput() }),
    ).rejects.toThrow(/permission denied/);
  });

  it('strips cached todaysCall when persisting a chat turn (forces recompose next /coach load)', async () => {
    const cachedTodaysCall = {
      headline: 'Stale call from earlier',
      runSession: 'Long Run',
      details: 'stale',
      exactWork: 'stale',
      strengthMobility: 'stale',
      fuel: 'stale',
      rationale: 'stale',
      phaseContext: 'stale',
      composedAt: '2026-05-21T06:00:00Z',
      llmInvoked: true,
    };
    const { supabase, calls } = buildFakeSupabase({
      existingSummaryRow: {
        id: 'existing-id',
        summary: {
          longevityContext: { recoveryPriority: 'normal' },
          todaysCall: cachedTodaysCall,
          someOtherKey: 'preserved',
        },
        training_recommendation: 'old value',
      },
    });

    const output = sampleOutput();
    output.injurySignal = { detected: false, rationale: 'no injury' };

    await persistTrainingCoachRun(supabase, {
      userId: 'user-1',
      today: '2026-05-21',
      output,
    });

    const updateCall = calls.find((c) => c.table === 'daily_summaries' && c.method === 'update');
    expect(updateCall).toBeDefined();
    const payload = updateCall!.payload as { summary: Record<string, unknown> };
    // todaysCall must be stripped so /coach recomposes with the new
    // conversation context (injury report, recovery report, etc.).
    expect(payload.summary.todaysCall).toBeUndefined();
    // Other keys MUST be preserved.
    expect(payload.summary.longevityContext).toEqual({ recoveryPriority: 'normal' });
    expect(payload.summary.someOtherKey).toBe('preserved');
    // Coach-conversation keys still updated normally.
    expect(payload.summary.coachConversation).toHaveLength(2);
  });
});

describe('loadTrainingCoachState', () => {
  it('returns empty conversation + null followUp when no row exists', async () => {
    const { supabase } = buildFakeSupabase({});
    const state = await loadTrainingCoachState(supabase, { userId: 'user-1', today: '2026-05-21' });
    expect(state.conversation).toEqual([]);
    expect(state.followUp).toBeNull();
  });

  it('returns persisted conversation + followUp when present', async () => {
    const { supabase } = buildFakeSupabase({
      existingSummaryRow: {
        id: 'existing-id',
        summary: {
          coachConversation: [{ role: 'athlete', text: 'hello' }],
          coachFollowUp: { easyThroughDate: '2026-05-24', checkInDate: '2026-05-25', status: 'active' },
        },
        training_recommendation: null,
      },
    });

    const state = await loadTrainingCoachState(supabase, { userId: 'user-1', today: '2026-05-21' });
    expect(state.conversation).toHaveLength(1);
    expect(state.followUp?.status).toBe('active');
  });
});
