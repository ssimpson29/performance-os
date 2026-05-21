import { describe, expect, it, vi } from 'vitest';

import { loadLongevityContext, persistLongevityRun } from '../lib/longevity/persistence';
import type { LongevityGuruOutput } from '../lib/agents/longevity-guru';

type CapturedCall = { table: string; method: string; payload?: unknown };

function buildFakeSupabase(opts: {
  existingSummaryRow?: { id: string; summary: Record<string, unknown> | null; longevity_priority: string | null };
  insertedSummaryId?: string;
  loadError?: { message: string };
}) {
  const calls: CapturedCall[] = [];

  const makeChain = (table: string, method: string, payload?: unknown) => {
    calls.push({ table, method, payload });

    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'limit', 'order']) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.single = async () => ({ data: { id: opts.insertedSummaryId ?? 'fresh-id' }, error: null });

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
      resolve({ data: null, error: null });
    };
    return chain;
  };

  const supabase = {
    from: (table: string) => ({
      select: (...args: unknown[]) => makeChain(table, 'select', args),
      update: (payload: unknown) => makeChain(table, 'update', payload),
      insert: (payload: unknown) => makeChain(table, 'insert', payload),
    }),
  } as unknown as Parameters<typeof persistLongevityRun>[0];

  return { supabase, calls };
}

const sampleOutput = (): LongevityGuruOutput => ({
  priorities: [
    {
      leverKey: 'cardiometabolic',
      severity: 2.5,
      contributingMarkers: ['Apolipoprotein B'],
      recommendation: 'Tighten metabolic + cardiovascular levers (ApoB / glycemic control).',
      rationale: 'Marker outside optimal in cardiometabolic.',
    },
  ],
  watching: [],
  markerEvaluations: [
    {
      markerKey: 'apob',
      displayName: 'Apolipoprotein B',
      domain: 'cardiometabolic',
      flag: 'high',
      optimalDelta: 1.0,
      trend: null,
      rationale: 'High',
    },
  ],
  narrative: 'Top lever right now: cardiometabolic.',
  cautions: ['At least one marker is outside clinical reference; review with a physician.'],
  longevityContext: {
    recoveryPriority: 'elevated',
    notes: 'Longevity Guru: cardiometabolic signal is strong.',
    evaluatedAt: '2026-05-21T00:00:00.000Z',
  },
  conflictsWithTraining: [{ leverKey: 'cardiometabolic', description: 'sustained-signal wins for longevity.' }],
  llmInvoked: false,
});

describe('persistLongevityRun', () => {
  it('inserts a new daily_summaries row when none exists', async () => {
    const { supabase, calls } = buildFakeSupabase({ insertedSummaryId: 'fresh-id' });
    const result = await persistLongevityRun(supabase, {
      userId: 'user-1',
      today: '2026-05-21',
      output: sampleOutput(),
    });
    expect(result.summaryId).toBe('fresh-id');

    const insertCall = calls.find((c) => c.table === 'daily_summaries' && c.method === 'insert');
    expect(insertCall, 'daily_summaries insert call').toBeDefined();
    const payload = insertCall!.payload as { summary: Record<string, unknown>; longevity_priority: string | null };
    expect(payload.longevity_priority).toMatch(/cardiometabolic/);
    expect(payload.summary.longevityContext).toMatchObject({ recoveryPriority: 'elevated' });
  });

  it('updates an existing row and merges without clobbering Training Coach state', async () => {
    const existingTrainingCoachState = {
      coachConversation: [{ role: 'athlete', text: 'foot hurts' }],
      coachFollowUp: { easyThroughDate: '2026-05-24', checkInDate: '2026-05-25', status: 'active', bodyPart: 'foot' },
      coachRecommendations: ['Monday: easy run'],
      coachRationale: 'Fatigue: manageable.',
    };
    const { supabase, calls } = buildFakeSupabase({
      existingSummaryRow: {
        id: 'existing-id',
        summary: existingTrainingCoachState,
        longevity_priority: null,
      },
    });

    await persistLongevityRun(supabase, { userId: 'user-1', today: '2026-05-21', output: sampleOutput() });

    const updateCall = calls.find((c) => c.table === 'daily_summaries' && c.method === 'update');
    expect(updateCall, 'update call').toBeDefined();
    const payload = updateCall!.payload as { summary: Record<string, unknown>; longevity_priority: string | null };
    // Training Coach keys preserved.
    expect(payload.summary.coachConversation).toEqual(existingTrainingCoachState.coachConversation);
    expect(payload.summary.coachFollowUp).toEqual(existingTrainingCoachState.coachFollowUp);
    expect(payload.summary.coachRecommendations).toEqual(existingTrainingCoachState.coachRecommendations);
    expect(payload.summary.coachRationale).toBe(existingTrainingCoachState.coachRationale);
    // Longevity keys added.
    expect(payload.summary.longevityContext).toMatchObject({ recoveryPriority: 'elevated' });
    expect(payload.summary.longevityPriorities).toHaveLength(1);
  });

  it('throws when the daily_summaries load query errors', async () => {
    const { supabase } = buildFakeSupabase({ loadError: { message: 'permission denied' } });
    await expect(
      persistLongevityRun(supabase, { userId: 'user-1', today: '2026-05-21', output: sampleOutput() }),
    ).rejects.toThrow(/permission denied/);
  });

  it('writes null longevity_priority text when there are no priorities', async () => {
    const { supabase, calls } = buildFakeSupabase({});
    const empty = sampleOutput();
    empty.priorities = [];
    await persistLongevityRun(supabase, { userId: 'user-1', today: '2026-05-21', output: empty });
    const insertCall = calls.find((c) => c.table === 'daily_summaries' && c.method === 'insert');
    const payload = insertCall!.payload as { longevity_priority: string | null };
    expect(payload.longevity_priority).toBeNull();
  });
});

describe('loadLongevityContext', () => {
  it('returns null when no daily_summary exists', async () => {
    const { supabase } = buildFakeSupabase({});
    const ctx = await loadLongevityContext(supabase, { userId: 'user-1', today: '2026-05-21' });
    expect(ctx).toBeNull();
  });

  it('returns the persisted context when present', async () => {
    const { supabase } = buildFakeSupabase({
      existingSummaryRow: {
        id: 'existing-id',
        summary: {
          longevityContext: { recoveryPriority: 'elevated', notes: 'cardiometabolic signal', evaluatedAt: '2026-05-21T00:00:00.000Z' },
        },
        longevity_priority: 'cardiometabolic',
      },
    });
    const ctx = await loadLongevityContext(supabase, { userId: 'user-1', today: '2026-05-21' });
    expect(ctx?.recoveryPriority).toBe('elevated');
  });
});
