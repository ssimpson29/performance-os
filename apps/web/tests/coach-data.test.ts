import { describe, expect, it, vi } from 'vitest';

import {
  loadActiveTrainingPlan,
  loadAdaptiveCoachContext,
  loadCompletedWorkouts,
  loadLongevityContextForAthlete,
  loadRecoveryHistory,
} from '../app/plan/coach-data';

type QueryResult = { data: unknown; error: { message: string } | null };

function makeChain(result: QueryResult) {
  // Supabase chain: from().select().eq().gte().lte().order() -> resolves
  // Each method returns the same chain; only the terminal "then" matters.
  const thenable = {
    then: (resolve: (r: QueryResult) => void) => resolve(result),
  };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  Object.assign(chain, thenable);
  return chain;
}

function makeSupabase(perTable: Record<string, QueryResult>) {
  return {
    from: vi.fn((table: string) => makeChain(perTable[table] ?? { data: [], error: null })),
  } as unknown as Parameters<typeof loadCompletedWorkouts>[0];
}

describe('loadCompletedWorkouts', () => {
  it('maps DB rows to CompletedWorkout shape, deriving day-of-week and loadScore', async () => {
    const supabase = makeSupabase({
      workouts: {
        data: [
          {
            local_date: '2026-05-16', // Saturday
            workout_type: 'Long Run',
            duration_seconds: 7200, // 120 min
            perceived_exertion: 7,
          },
          {
            local_date: '2026-05-17', // Sunday
            workout_type: 'Recovery Run',
            duration_seconds: 1800, // 30 min
            perceived_exertion: 3,
          },
        ],
        error: null,
      },
    });

    const result = await loadCompletedWorkouts(supabase, 'user-1', { today: '2026-05-21' });

    expect(result).toEqual([
      {
        day: 'Saturday',
        durationMinutes: 120,
        intensityScore: 7,
        loadScore: 120 + 7 * 20, // 260
        sessionType: 'Long Run',
      },
      {
        day: 'Sunday',
        durationMinutes: 30,
        intensityScore: 3,
        loadScore: 30 + 3 * 20, // 90
        sessionType: 'Recovery Run',
      },
    ]);
  });

  it('defaults intensityScore to 5 when perceived_exertion is null', async () => {
    const supabase = makeSupabase({
      workouts: {
        data: [
          {
            local_date: '2026-05-18',
            workout_type: 'Aerobic Run',
            duration_seconds: 3600,
            perceived_exertion: null,
          },
        ],
        error: null,
      },
    });

    const [w] = await loadCompletedWorkouts(supabase, 'user-1', { today: '2026-05-21' });
    expect(w.intensityScore).toBe(5);
    expect(w.loadScore).toBe(60 + 5 * 20);
  });

  it('throws when the query fails', async () => {
    const supabase = makeSupabase({
      workouts: { data: null, error: { message: 'permission denied' } },
    });
    await expect(loadCompletedWorkouts(supabase, 'user-1')).rejects.toThrow(/permission denied/);
  });
});

describe('loadRecoveryHistory', () => {
  it('filters out null readiness rows and returns RecoverySample list', async () => {
    const supabase = makeSupabase({
      recovery_daily: {
        data: [
          { day: '2026-05-15', readiness_score: 78 },
          { day: '2026-05-16', readiness_score: null },
          { day: '2026-05-17', readiness_score: 82 },
        ],
        error: null,
      },
    });

    const result = await loadRecoveryHistory(supabase, 'user-1', { today: '2026-05-21' });
    expect(result).toEqual([
      { date: '2026-05-15', score: 78 },
      { date: '2026-05-17', score: 82 },
    ]);
  });
});

describe('loadActiveTrainingPlan', () => {
  it("returns the athlete's most recent plan with parsed metadata", async () => {
    const supabase = makeSupabase({
      training_plans: {
        data: [
          {
            id: 'plan-1',
            start_date: '2026-02-02',
            end_date: '2026-08-07',
            goal: 'Place top 10 at Swiss Alps 100',
            metadata: {
              weeklyStructure: [
                { day: 'Monday', runSession: 'Aerobic', details: '', strengthMobility: '', exactWork: '' },
              ],
              phaseBlocks: [
                {
                  phaseName: 'PHASE 1: FOUNDATION BUILD',
                  headers: ['Week'],
                  weeks: [{ weekLabel: '1', mileageTarget: '60', vertTarget: '5000', isDeload: false, metadata: {} }],
                },
              ],
              raceContext: {
                raceName: 'Swiss Alps 100',
                raceDate: '2026-08-07',
                distanceKm: 160,
                goal: 'Place top 10',
              },
            },
            created_at: '2026-02-01T00:00:00Z',
          },
        ],
        error: null,
      },
    });

    const plan = await loadActiveTrainingPlan(supabase, 'user-1');
    expect(plan).not.toBeNull();
    expect(plan?.planId).toBe('plan-1');
    expect(plan?.raceDate).toBe('2026-08-07');
    expect(plan?.weeklyStructure).toHaveLength(1);
    expect(plan?.phaseBlocks).toHaveLength(1);
    expect(plan?.raceContext?.raceName).toBe('Swiss Alps 100');
  });

  it('returns null when the athlete has no plans', async () => {
    const supabase = makeSupabase({
      training_plans: { data: [], error: null },
    });
    const plan = await loadActiveTrainingPlan(supabase, 'user-1');
    expect(plan).toBeNull();
  });
});

describe('loadAdaptiveCoachContext', () => {
  it('composes plan + workouts + recovery into a full AdaptiveCoachInput', async () => {
    const supabase = makeSupabase({
      training_plans: {
        data: [
          {
            id: 'plan-1',
            start_date: '2026-02-02',
            end_date: '2026-08-07',
            goal: 'Place top 10',
            metadata: {
              weeklyStructure: [
                { day: 'Monday', runSession: 'Aerobic', details: '', strengthMobility: '', exactWork: '' },
              ],
              phaseBlocks: [
                {
                  phaseName: 'PHASE 1: FOUNDATION BUILD',
                  headers: ['Week'],
                  weeks: [{ weekLabel: '1', mileageTarget: '60', vertTarget: '5000', isDeload: false, metadata: {} }],
                },
              ],
            },
            created_at: '2026-02-01T00:00:00Z',
          },
        ],
        error: null,
      },
      workouts: {
        data: [
          {
            local_date: '2026-05-17', // Sunday
            workout_type: 'Long Run',
            duration_seconds: 3600,
            perceived_exertion: 6,
          },
        ],
        error: null,
      },
      recovery_daily: {
        data: [
          { day: '2026-05-19', readiness_score: 75 },
          { day: '2026-05-20', readiness_score: 80 },
        ],
        error: null,
      },
    });

    const ctx = await loadAdaptiveCoachContext(supabase, 'user-1', { today: '2026-05-21' });

    expect(ctx.today).toBe('2026-05-21');
    expect(ctx.currentDay).toBe('Thursday');
    expect(ctx.planStartDate).toBe('2026-02-02');
    expect(ctx.raceDate).toBe('2026-08-07');
    expect(ctx.goal).toBe('Place top 10');
    expect(ctx.weeklyStructure).toHaveLength(1);
    expect(ctx.phaseBlocks).toHaveLength(1);
    expect(ctx.completedWorkouts).toHaveLength(1);
    expect(ctx.recoveryHistory).toHaveLength(2);
    expect(ctx.recoveryScore).toBe(80); // most recent
  });

  it('uses planOverride and skips the training_plans lookup when supplied', async () => {
    const supabase = makeSupabase({
      // Note: no training_plans entry — would throw if loader queried it.
      workouts: { data: [], error: null },
      recovery_daily: { data: [], error: null },
    });

    const override = {
      planId: 'inline-plan',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      goal: 'Goal text',
      weeklyStructure: [],
      phaseBlocks: [],
      supportTemplates: [],
    };

    const ctx = await loadAdaptiveCoachContext(supabase, 'user-1', {
      today: '2026-05-21',
      planOverride: override,
    });

    expect(ctx.raceDate).toBe('2026-08-07');
    expect(supabase.from).not.toHaveBeenCalledWith('training_plans');
  });

  it('throws when athlete has no plan and no override is supplied', async () => {
    const supabase = makeSupabase({
      training_plans: { data: [], error: null },
    });
    await expect(loadAdaptiveCoachContext(supabase, 'user-1', { today: '2026-05-21' })).rejects.toThrow(
      /No active training plan/,
    );
  });
});

describe('loadLongevityContextForAthlete', () => {
  it('returns the parsed context when present', async () => {
    const supabase = makeSupabase({
      daily_summaries: {
        data: [
          {
            summary: {
              longevityContext: {
                recoveryPriority: 'elevated',
                notes: 'cardiometabolic signal',
                evaluatedAt: '2026-05-21T00:00:00.000Z',
              },
            },
          },
        ],
        error: null,
      },
    });
    const ctx = await loadLongevityContextForAthlete(supabase, 'user-1', '2026-05-21');
    expect(ctx?.recoveryPriority).toBe('elevated');
    expect(ctx?.notes).toBe('cardiometabolic signal');
  });

  it('returns null when no row exists', async () => {
    const supabase = makeSupabase({ daily_summaries: { data: [], error: null } });
    const ctx = await loadLongevityContextForAthlete(supabase, 'user-1', '2026-05-21');
    expect(ctx).toBeNull();
  });

  it('returns null when summary exists but longevityContext is unset', async () => {
    const supabase = makeSupabase({
      daily_summaries: { data: [{ summary: { coachConversation: [] } }], error: null },
    });
    const ctx = await loadLongevityContextForAthlete(supabase, 'user-1', '2026-05-21');
    expect(ctx).toBeNull();
  });

  it('returns null when recoveryPriority is malformed', async () => {
    const supabase = makeSupabase({
      daily_summaries: {
        data: [{ summary: { longevityContext: { recoveryPriority: 'unknown-value' } } }],
        error: null,
      },
    });
    const ctx = await loadLongevityContextForAthlete(supabase, 'user-1', '2026-05-21');
    expect(ctx).toBeNull();
  });
});

describe('loadAdaptiveCoachContext — threads longevityContext through', () => {
  it('passes longevityContext from daily_summaries into the assembled coach input', async () => {
    const supabase = makeSupabase({
      training_plans: {
        data: [
          {
            id: 'plan-1',
            start_date: '2026-02-02',
            end_date: '2026-08-07',
            goal: 'place top 10',
            metadata: { weeklyStructure: [], phaseBlocks: [] },
            created_at: '2026-02-01T00:00:00Z',
          },
        ],
        error: null,
      },
      workouts: { data: [], error: null },
      recovery_daily: { data: [], error: null },
      daily_summaries: {
        data: [
          {
            summary: {
              longevityContext: {
                recoveryPriority: 'elevated',
                notes: 'cardiometabolic + inflammation',
                evaluatedAt: '2026-05-21T00:00:00.000Z',
              },
            },
          },
        ],
        error: null,
      },
    });
    const ctx = await loadAdaptiveCoachContext(supabase, 'user-1', { today: '2026-05-21' });
    expect(ctx.longevityContext?.recoveryPriority).toBe('elevated');
    expect(ctx.longevityContext?.notes).toMatch(/cardiometabolic/);
  });

  it('leaves longevityContext undefined when no daily_summary is present', async () => {
    const supabase = makeSupabase({
      training_plans: {
        data: [
          {
            id: 'plan-1',
            start_date: '2026-02-02',
            end_date: '2026-08-07',
            goal: null,
            metadata: { weeklyStructure: [], phaseBlocks: [] },
            created_at: '2026-02-01T00:00:00Z',
          },
        ],
        error: null,
      },
      workouts: { data: [], error: null },
      recovery_daily: { data: [], error: null },
      daily_summaries: { data: [], error: null },
    });
    const ctx = await loadAdaptiveCoachContext(supabase, 'user-1', { today: '2026-05-21' });
    expect(ctx.longevityContext).toBeUndefined();
  });
});
