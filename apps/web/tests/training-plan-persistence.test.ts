import { describe, expect, it } from 'vitest';

import { persistImportedTrainingPlan } from '../lib/training-plan/persistence';
import type { ParsedTrainingPlan } from '../lib/training-plan/types';

type CapturedInsert = {
  table: string;
  payload: unknown;
};

function buildParsedPlan(): ParsedTrainingPlan {
  return {
    planName: 'Swiss Alps 100',
    sourceFileName: 'Swiss Alps 100.xlsx',
    sheetNames: ['Weekly Schedule', 'Daily', 'Strength Days', 'Speed Warmup'],
    weeklyStructure: [
      {
        day: 'Monday',
        runSession: 'Aerobic Run',
        details: '45–60 min easy',
        strengthMobility: 'Lift A (Posterior Chain)',
        exactWork: 'Z2 run + lift',
      },
      {
        day: 'Saturday',
        runSession: 'Long Run',
        details: '3h easy with vert',
        strengthMobility: '',
        exactWork: 'Long Z2 with sustained climbs',
      },
    ],
    phaseBlocks: [
      {
        phaseName: 'PHASE 1: FOUNDATION BUILD (Weeks 1–6)',
        headers: ['Week', 'Mileage', 'Vert'],
        weeks: [
          {
            weekLabel: '1',
            mileageTarget: '62–65',
            vertTarget: '4,500 ft',
            isDeload: false,
            metadata: {},
          },
        ],
      },
    ],
    supportTemplates: [
      {
        name: 'Daily Routine',
        sourceSheet: 'Daily',
        items: [{ label: 'Hydration', metadata: {} }],
      },
    ],
  };
}

function buildFakeSupabase() {
  const captured: CapturedInsert[] = [];

  const supabase = {
    from(table: string) {
      return {
        insert(payload: unknown) {
          captured.push({ table, payload });
          // training_plans insert is chained .select('id').single()
          if (table === 'training_plans') {
            return {
              select: () => ({
                single: async () => ({ data: { id: 'plan-1' }, error: null }),
              }),
            };
          }
          // planned_sessions insert resolves directly
          return Promise.resolve({ error: null });
        },
      };
    },
  } as const;

  return { supabase, captured };
}

describe('persistImportedTrainingPlan', () => {
  it('throws when userId is missing', async () => {
    const { supabase } = buildFakeSupabase();
    const parsed = buildParsedPlan();

    await expect(
      persistImportedTrainingPlan(supabase as never, parsed, { startDate: '2026-02-02' }),
    ).rejects.toThrow(/userId is required/);
  });

  it('persists end_date, goal, and race metadata when raceContext is provided', async () => {
    const { supabase, captured } = buildFakeSupabase();
    const parsed = buildParsedPlan();

    await persistImportedTrainingPlan(supabase as never, parsed, {
      userId: 'user-1',
      startDate: '2026-02-02',
      endDate: '2026-08-07',
      goal: 'Finish Swiss Alps 100 (160km) in under 36 hours',
      raceContext: {
        raceName: 'Swiss Alps 100',
        raceDate: '2026-08-07',
        distanceKm: 160,
        elevationGainM: 9000,
        goal: 'Finish Swiss Alps 100 (160km) in under 36 hours',
        notes: 'A-race for 2026 season',
      },
    });

    const planInsert = captured.find((c) => c.table === 'training_plans');
    expect(planInsert, 'training_plans insert call').toBeDefined();

    const payload = planInsert!.payload as {
      user_id: string;
      start_date: string | null;
      end_date: string | null;
      goal: string | null;
      metadata: Record<string, unknown>;
    };

    expect(payload.user_id).toBe('user-1');
    expect(payload.start_date).toBe('2026-02-02');
    expect(payload.end_date).toBe('2026-08-07');
    expect(payload.goal).toBe('Finish Swiss Alps 100 (160km) in under 36 hours');

    expect(payload.metadata).toMatchObject({
      sourceFileName: 'Swiss Alps 100.xlsx',
      weeklyStructure: parsed.weeklyStructure,
      phaseBlocks: parsed.phaseBlocks,
      supportTemplates: parsed.supportTemplates,
      raceContext: {
        raceName: 'Swiss Alps 100',
        raceDate: '2026-08-07',
        distanceKm: 160,
        elevationGainM: 9000,
        goal: 'Finish Swiss Alps 100 (160km) in under 36 hours',
        notes: 'A-race for 2026 season',
      },
    });
  });

  it('persists weeklyStructure but leaves end_date, goal, and raceContext absent when not provided', async () => {
    const { supabase, captured } = buildFakeSupabase();
    const parsed = buildParsedPlan();

    await persistImportedTrainingPlan(supabase as never, parsed, {
      userId: 'user-1',
      startDate: '2026-02-02',
    });

    const planInsert = captured.find((c) => c.table === 'training_plans');
    expect(planInsert, 'training_plans insert call').toBeDefined();

    const payload = planInsert!.payload as {
      end_date: string | null;
      goal: string | null;
      metadata: Record<string, unknown>;
    };

    expect(payload.end_date ?? null).toBeNull();
    expect(payload.goal ?? null).toBeNull();
    expect(payload.metadata).toMatchObject({
      weeklyStructure: parsed.weeklyStructure,
      phaseBlocks: parsed.phaseBlocks,
      supportTemplates: parsed.supportTemplates,
    });
    expect(payload.metadata).not.toHaveProperty('raceContext');
  });
});

