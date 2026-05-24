import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks for every external dependency `loadPlanView` reaches into. The
// goal of this test file is the cache-read wiring added by fix #2 (unify
// /coach Today's Call with /plan today row): when loadCachedTodaysCall
// returns a value, it must thread through to PlanView.todaysCall so the
// page render mirrors /coach. Cache miss → todaysCall stays null and
// the page falls back to the plan template.

const getAuthenticatedUser = vi.fn();
const createServerSupabaseClient = vi.fn();
const loadActiveTrainingPlan = vi.fn();
const loadAdaptiveCoachContext = vi.fn();
const adaptWeeklyStructure = vi.fn();
const loadCachedTodaysCall = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUser }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));
vi.mock('@/app/plan/coach-data', () => ({
  loadActiveTrainingPlan,
  loadAdaptiveCoachContext,
}));
vi.mock('@/lib/training-plan/adaptive-coach', () => ({ adaptWeeklyStructure }));
vi.mock('@/lib/agents/todays-call-cache', () => ({ loadCachedTodaysCall }));

type QueryResult = { data: unknown; error: { message: string } | null };

function makeSupabase(perTable: Record<string, QueryResult>) {
  const thenableFor = (table: string) => ({
    then: (resolve: (r: QueryResult) => void) =>
      resolve(perTable[table] ?? { data: [], error: null }),
  });
  return {
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit', 'order']) {
        chain[m] = vi.fn(() => chain);
      }
      Object.assign(chain, thenableFor(table));
      return chain;
    }),
  } as unknown as ReturnType<typeof createServerSupabaseClient>;
}

const PLAN_STUB = {
  planId: 'plan-1',
  planStartDate: '2026-02-02',
  raceDate: '2026-08-07',
  goal: 'Swiss Alps 100',
  weeklyStructure: [
    {
      day: 'Sunday',
      runSession: 'Long Run',
      details: '2.5–3 hrs Zone 2 trail',
      strengthMobility: 'None',
      exactWork: 'Fuel 70g/hr',
    },
  ],
  phaseBlocks: [
    {
      phaseName: 'PHASE 1: FOUNDATION BUILD',
      headers: ['Week'],
      weeks: [
        { weekLabel: '1', mileageTarget: '60', vertTarget: '5,000 ft', isDeload: false, metadata: {} },
      ],
    },
  ],
  supportTemplates: [],
};

const ADAPTIVE_STUB = {
  fatigueState: 'manageable' as const,
  overloadScore: 100,
  recommendations: [],
  coachingPosture: 'balanced' as const,
};

describe('loadPlanView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Defaults: signed-in athlete with a plan, cache miss, balanced engine output.
    loadCachedTodaysCall.mockResolvedValue(null);
    adaptWeeklyStructure.mockReturnValue(ADAPTIVE_STUB);
    loadAdaptiveCoachContext.mockResolvedValue({});
  });

  it('returns kind="unauthenticated" when no auth session', async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const { loadPlanView } = await import('../app/plan/plan-data');
    const view = await loadPlanView();
    expect(view).toEqual({ kind: 'unauthenticated' });
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it('returns kind="no-plan" when athlete is signed in but no training plan exists', async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1', email: 's@test.com' });
    createServerSupabaseClient.mockReturnValue(makeSupabase({}));
    loadActiveTrainingPlan.mockResolvedValue(null);

    const { loadPlanView } = await import('../app/plan/plan-data');
    const view = await loadPlanView();
    expect(view.kind).toBe('no-plan');
    // Cache should not be probed on the no-plan branch — early return.
    expect(loadCachedTodaysCall).not.toHaveBeenCalled();
  });

  it('returns ready with todaysCall=null when cache miss (athlete has not visited /coach today)', async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1', email: 's@test.com' });
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        training_plans: { data: [{ name: 'Imported plan', metadata: {} }], error: null },
      }),
    );
    loadActiveTrainingPlan.mockResolvedValue(PLAN_STUB);
    loadCachedTodaysCall.mockResolvedValue(null); // explicit cache miss

    const { loadPlanView } = await import('../app/plan/plan-data');
    const view = await loadPlanView();

    expect(view.kind).toBe('ready');
    if (view.kind !== 'ready') return;
    expect(view.todaysCall).toBeNull();
    expect(view.planName).toBe('Imported plan');
    expect(view.raceDate).toBe('2026-08-07');
    // Wiring sanity: cache loader was called with the authenticated userId.
    expect(loadCachedTodaysCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('returns ready with the cached Today\'s Call when present (this is the unification fix)', async () => {
    // The bug Scott hit: /coach Today's Call (LLM-composed, race-aware)
    // showed one session, while /plan "This week — today" showed the
    // plan template's runSession. Now /plan reads the same cache so
    // the today row mirrors /coach exactly.
    const cachedCall = {
      headline: 'Long Run · 4-hour Zone 2 with 3,500 ft vert',
      runSession: 'Long Run',
      details: '4 hours easy on rolling terrain, fuel 75g/hr',
      exactWork: 'Stay in Zone 2; HR < 145',
      strengthMobility: 'None',
      fuel: '75g carbs/hr; 500ml/hr',
      rationale: 'Phase 3 specific load — long aerobic with terrain.',
      phaseContext: 'PHASE 3: PEAK SPECIFICITY · week 18 of 27',
      composedAt: '2026-05-24T07:00:00Z',
      llmInvoked: true,
    };
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1', email: 's@test.com' });
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        training_plans: { data: [{ name: 'Imported plan', metadata: {} }], error: null },
      }),
    );
    loadActiveTrainingPlan.mockResolvedValue(PLAN_STUB);
    loadCachedTodaysCall.mockResolvedValue(cachedCall);

    const { loadPlanView } = await import('../app/plan/plan-data');
    const view = await loadPlanView();

    expect(view.kind).toBe('ready');
    if (view.kind !== 'ready') return;
    expect(view.todaysCall).toEqual(cachedCall);
    // The page render uses view.todaysCall.headline + view.todaysCall.details
    // for the today row; type-check both surface fields are present.
    expect(view.todaysCall?.headline).toContain('Long Run');
    expect(view.todaysCall?.details).toContain('rolling terrain');
  });

  it('returns kind="unauthenticated" when an unexpected loader error throws', async () => {
    // Loader is exception-safe — a transient DB error degrades to
    // sign-in-CTA rather than a 500 crash. Logged for diagnostics.
    getAuthenticatedUser.mockRejectedValue(new Error('supabase boom'));
    const { loadPlanView } = await import('../app/plan/plan-data');
    const view = await loadPlanView();
    expect(view).toEqual({ kind: 'unauthenticated' });
  });
});
