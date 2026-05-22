import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUser = vi.fn();
const createServerSupabaseClient = vi.fn();
const loadActiveTrainingPlan = vi.fn();
const loadAdaptiveCoachContext = vi.fn();
const adaptWeeklyStructure = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUser }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));
vi.mock('@/app/plan/coach-data', () => ({
  loadActiveTrainingPlan,
  loadAdaptiveCoachContext,
}));
vi.mock('@/lib/training-plan/adaptive-coach', () => ({ adaptWeeklyStructure }));

type QueryResult = { data: unknown; error: { message: string } | null };

function makeSupabase(perTable: Record<string, QueryResult>) {
  return {
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit', 'order']) {
        chain[m] = (..._args: unknown[]) => chain;
      }
      chain.then = (resolve: (r: QueryResult) => void) =>
        resolve(perTable[table] ?? { data: [], error: null });
      return chain;
    }),
  };
}

describe('loadTodayPageState', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns unauthenticated when no auth session', async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const { loadTodayPageState } = await import('../app/today/today-data');
    const state = await loadTodayPageState();
    expect(state.kind).toBe('unauthenticated');
  });

  it("returns 'no-plan' when athlete signed in but no plan", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'u1', email: 's@x' });
    createServerSupabaseClient.mockReturnValue(makeSupabase({}));
    loadActiveTrainingPlan.mockResolvedValue(null);
    const { loadTodayPageState } = await import('../app/today/today-data');
    const state = await loadTodayPageState();
    expect(state.kind).toBe('no-plan');
  });

  it("returns 'ready' with anchor session matching the day-of-week", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'u1', email: 's@x' });
    const supportTemplates = [
      {
        name: 'Strength Day A',
        sourceSheet: 'Strength Days',
        items: [{ label: 'Bulgarian Split Squat', prescription: '3x8 each leg', metadata: {} }],
      },
      {
        name: 'Daily Routine',
        sourceSheet: 'Daily',
        items: [{ label: 'Short Foot Holds', prescription: '2x 20 sec/foot', metadata: {} }],
      },
    ];
    loadActiveTrainingPlan.mockResolvedValue({
      planId: 'p1',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      goal: 'Place top 10',
      weeklyStructure: [
        { day: 'Monday', runSession: 'Aerobic Run', details: '8-10 mi Z2', strengthMobility: 'Lift A', exactWork: 'See Strength Sheet' },
        { day: 'Tuesday', runSession: 'Quality', details: 'intervals', strengthMobility: 'None', exactWork: '' },
      ],
      phaseBlocks: [
        {
          phaseName: 'PHASE 1: FOUNDATION BUILD',
          headers: [],
          weeks: [{ weekLabel: '1', mileageTarget: '65', vertTarget: '4500', isDeload: false, metadata: {} }],
        },
      ],
      supportTemplates,
    });
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        recovery_daily: { data: [{ day: '2026-02-09', readiness_score: 80, sleep_score: 78, hrv_ms: 65, resting_hr: 50 }], error: null },
        daily_summaries: { data: [], error: null },
      }),
    );
    loadAdaptiveCoachContext.mockResolvedValue({});
    adaptWeeklyStructure.mockReturnValue({
      fatigueState: 'manageable',
      overloadScore: 100,
      recommendations: [
        { day: 'Monday', baseSessionType: 'Aerobic Run', recommendedSessionType: 'Aerobic Run', action: 'keep', reason: 'base' },
      ],
      phasePosition: {
        phaseName: 'PHASE 1: FOUNDATION BUILD',
        phaseIndex: 0,
        weekIndexInPhase: 0,
        totalWeekIndex: 0,
        weeksToRace: 26,
        isRaceWeek: false,
        isTaper: false,
        raiseAllowed: true,
      },
    });

    const { loadTodayPageState } = await import('../app/today/today-data');
    // 2026-02-09 is a Monday.
    const state = await loadTodayPageState({ today: '2026-02-09' });
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.day).toBe('Monday');
      expect(state.anchorSession?.runSession).toBe('Aerobic Run');
      expect(state.adaptedRecommendation?.day).toBe('Monday');
      expect(state.strengthTemplate?.name).toBe('Strength Day A');
      expect(state.dailyRoutine?.name).toBe('Daily Routine');
      expect(state.phaseWeekTarget?.mileageTarget).toBe('65');
      expect(state.phaseName).toBe('PHASE 1: FOUNDATION BUILD');
      expect(state.recovery?.readinessScore).toBe(80);
    }
  });
});
