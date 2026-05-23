import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUser = vi.fn();
const createServerSupabaseClient = vi.fn();
const loadActiveTrainingPlan = vi.fn();
const loadAthleteContext = vi.fn();
const composeTodaysCall = vi.fn();
const loadCachedTodaysCall = vi.fn();
const saveCachedTodaysCall = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUser }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));
vi.mock('@/app/plan/coach-data', () => ({ loadActiveTrainingPlan }));
vi.mock('@/lib/agents/athlete-context', () => ({ loadAthleteContext }));
vi.mock('@/lib/agents/todays-call', () => ({ composeTodaysCall }));
vi.mock('@/lib/agents/todays-call-cache', () => ({
  loadCachedTodaysCall,
  saveCachedTodaysCall,
}));

type QueryResult = { data: unknown; error: { message: string } | null };

function makeSupabase(perTable: Record<string, QueryResult>) {
  const thenableFor = (table: string) => ({
    then: (resolve: (r: QueryResult) => void) => resolve(perTable[table] ?? { data: [], error: null }),
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

// 2026-05-21 is a Thursday — used by the "ready" test below to match the
// Thursday entry in `weeklyStructure`. If you change `today`, update both.
const THURSDAY_SESSION = {
  day: 'Thursday',
  runSession: 'Tempo intervals',
  details: '6mi w/ 4x6min @ tempo, 2min jog',
  strengthMobility: 'Strength Day B — posterior chain',
  exactWork: '4x6min tempo @ 7:30/mi',
};

describe('loadCoachPageState', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: cache miss + composer disabled. Tests that need a specific
    // todaysCall behavior override these explicitly.
    loadCachedTodaysCall.mockResolvedValue(null);
    composeTodaysCall.mockResolvedValue(null);
    loadAthleteContext.mockResolvedValue({}); // unused when composer returns null
    saveCachedTodaysCall.mockResolvedValue(undefined);
  });

  it('returns kind="unauthenticated" when no auth session', async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const { loadCoachPageState } = await import('../app/coach/coach-data');
    const state = await loadCoachPageState();
    expect(state).toEqual({ kind: 'unauthenticated' });
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it('returns kind="no-plan" when athlete is signed in but has no training plan', async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1', email: 's@test.com' });
    createServerSupabaseClient.mockReturnValue(makeSupabase({}));
    loadActiveTrainingPlan.mockResolvedValue(null);

    const { loadCoachPageState } = await import('../app/coach/coach-data');
    const state = await loadCoachPageState();
    expect(state.kind).toBe('no-plan');
    if (state.kind === 'no-plan') {
      expect(state.userId).toBe('user-1');
      expect(state.email).toBe('s@test.com');
    }
  });

  it('returns kind="ready" with planned session for today plus persisted conversation', async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1', email: 's@test.com' });
    loadActiveTrainingPlan.mockResolvedValue({
      planId: 'plan-1',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      goal: 'Place top 10',
      weeklyStructure: [THURSDAY_SESSION],
      phaseBlocks: [],
      supportTemplates: [],
    });
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        daily_summaries: {
          data: [
            {
              summary: {
                coachConversation: [{ role: 'athlete', text: 'foot hurts' }],
                // These chat-driven fields are intentionally NOT surfaced in
                // CoachPageState anymore — the headline must come from the
                // planned session, not the last coach reply.
                coachRecommendations: ['Monday: Aerobic Run — base'],
                coachCautions: ['Recovery trending down'],
                coachRationale: 'Fatigue: manageable.',
                coachFollowUp: {
                  easyThroughDate: '2026-05-24',
                  checkInDate: '2026-05-25',
                  status: 'active',
                  bodyPart: 'foot',
                },
              },
            },
          ],
          error: null,
        },
        training_plans: {
          data: [{ name: 'Swiss Alps 100' }],
          error: null,
        },
      }),
    );

    const { loadCoachPageState } = await import('../app/coach/coach-data');
    const state = await loadCoachPageState({ today: '2026-05-21' });
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.planName).toBe('Swiss Alps 100');
      expect(state.goal).toBe('Place top 10');
      expect(state.raceDate).toBe('2026-08-07');
      expect(state.today).toBe('2026-05-21');
      expect(state.day).toBe('Thursday');
      expect(state.plannedSession).toEqual(THURSDAY_SESSION);
      expect(state.conversation).toHaveLength(1);
      expect(state.followUp?.bodyPart).toBe('foot');
    }
  });

  it('returns plannedSession=null when the plan has no entry for today’s day-of-week', async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1', email: 's@test.com' });
    loadActiveTrainingPlan.mockResolvedValue({
      planId: 'plan-1',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      goal: null,
      // Plan only defines Monday; today is Thursday → no match.
      weeklyStructure: [
        { day: 'Monday', runSession: 'Easy', details: '', strengthMobility: '', exactWork: '' },
      ],
      phaseBlocks: [],
      supportTemplates: [],
    });
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        daily_summaries: { data: [], error: null },
        training_plans: { data: [{ name: 'Swiss Alps 100' }], error: null },
      }),
    );

    const { loadCoachPageState } = await import('../app/coach/coach-data');
    const state = await loadCoachPageState({ today: '2026-05-21' });
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.day).toBe('Thursday');
      expect(state.plannedSession).toBeNull();
      expect(state.conversation).toEqual([]);
      expect(state.followUp).toBeNull();
    }
  });

  it('returns empty conversation + null followUp when athlete has a plan but no daily_summary for today', async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1', email: 's@test.com' });
    loadActiveTrainingPlan.mockResolvedValue({
      planId: 'plan-1',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      goal: null,
      weeklyStructure: [THURSDAY_SESSION],
      phaseBlocks: [],
      supportTemplates: [],
    });
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        daily_summaries: { data: [], error: null },
        training_plans: { data: [{ name: 'Swiss Alps 100' }], error: null },
      }),
    );

    const { loadCoachPageState } = await import('../app/coach/coach-data');
    const state = await loadCoachPageState({ today: '2026-05-21' });
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.plannedSession).toEqual(THURSDAY_SESSION);
      expect(state.conversation).toEqual([]);
      expect(state.followUp).toBeNull();
    }
  });
});

describe('loadCoachPageState — Today\'s Call composition', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    loadCachedTodaysCall.mockResolvedValue(null);
    composeTodaysCall.mockResolvedValue(null);
    loadAthleteContext.mockResolvedValue({});
    saveCachedTodaysCall.mockResolvedValue(undefined);
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1', email: 's@test.com' });
    loadActiveTrainingPlan.mockResolvedValue({
      planId: 'plan-1',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      goal: 'Place top 10 at Swiss Alps 100',
      weeklyStructure: [THURSDAY_SESSION],
      phaseBlocks: [],
      supportTemplates: [],
    });
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        daily_summaries: { data: [], error: null },
        training_plans: { data: [{ name: 'Swiss Alps 100' }], error: null },
      }),
    );
  });

  it('cache hit: skips compose + save, returns cached call', async () => {
    const cachedCall = {
      headline: 'Long Run · 32mi',
      runSession: 'Long Run',
      details: '5 hours easy with race-pace inserts',
      exactWork: '4×8min @ 7:30/mi',
      strengthMobility: 'Skip lifting',
      fuel: '70-90g carbs/hr',
      rationale: 'Cached from earlier today.',
      phaseContext: 'Phase 2 · week 5 · 11 weeks to race',
      composedAt: '2026-05-21T08:00:00Z',
      llmInvoked: true,
    };
    loadCachedTodaysCall.mockResolvedValue(cachedCall);

    const { loadCoachPageState } = await import('../app/coach/coach-data');
    const state = await loadCoachPageState({ today: '2026-05-21' });

    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.todaysCall).toEqual(cachedCall);
    }
    // Critical: we did NOT recompose or re-save on cache hit.
    expect(composeTodaysCall).not.toHaveBeenCalled();
    expect(loadAthleteContext).not.toHaveBeenCalled();
    expect(saveCachedTodaysCall).not.toHaveBeenCalled();
  });

  it('cache miss: composes fresh, persists to cache', async () => {
    loadCachedTodaysCall.mockResolvedValue(null);
    const freshCall = {
      headline: 'Quality · 6×800m',
      runSession: 'Quality',
      details: '6×800m at 5k pace, 2min jog rest',
      exactWork: '800m @ 3:00, 2min recovery jog',
      strengthMobility: 'Lift B',
      fuel: '30g carbs pre, 16oz water during',
      rationale: 'Recovery green, phase 2 quality day.',
      phaseContext: 'Phase 2 · week 5 · 11 weeks to race',
      composedAt: '2026-05-21T08:00:00Z',
      llmInvoked: true,
    };
    composeTodaysCall.mockResolvedValue(freshCall);
    loadAthleteContext.mockResolvedValue({ /* shape doesn't matter — composer is mocked */ });

    const { loadCoachPageState } = await import('../app/coach/coach-data');
    const state = await loadCoachPageState({ today: '2026-05-21' });

    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.todaysCall).toEqual(freshCall);
    }
    expect(composeTodaysCall).toHaveBeenCalledTimes(1);
    expect(saveCachedTodaysCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-1', today: '2026-05-21', call: freshCall }),
    );
  });

  it('compose returns null (e.g. env missing fallback also failed): no save, todaysCall is null, page still renders', async () => {
    loadCachedTodaysCall.mockResolvedValue(null);
    composeTodaysCall.mockResolvedValue(null);

    const { loadCoachPageState } = await import('../app/coach/coach-data');
    const state = await loadCoachPageState({ today: '2026-05-21' });

    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.todaysCall).toBeNull();
      // plannedSession is the fallback render path.
      expect(state.plannedSession).toEqual(THURSDAY_SESSION);
    }
    expect(saveCachedTodaysCall).not.toHaveBeenCalled();
  });

  it('composer throws: caught, state still returns with todaysCall=null', async () => {
    loadCachedTodaysCall.mockResolvedValue(null);
    composeTodaysCall.mockRejectedValue(new Error('LLM timeout'));

    const { loadCoachPageState } = await import('../app/coach/coach-data');
    const state = await loadCoachPageState({ today: '2026-05-21' });

    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.todaysCall).toBeNull();
    }
  });
});
