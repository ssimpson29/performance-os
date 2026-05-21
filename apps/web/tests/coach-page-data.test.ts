import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUser = vi.fn();
const createServerSupabaseClient = vi.fn();
const loadActiveTrainingPlan = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUser }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));
vi.mock('@/app/plan/coach-data', () => ({ loadActiveTrainingPlan }));

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

describe('loadCoachPageState', () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

  it('returns kind="ready" with persisted state when athlete + plan exist', async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1', email: 's@test.com' });
    loadActiveTrainingPlan.mockResolvedValue({
      planId: 'plan-1',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      goal: 'Place top 10',
      weeklyStructure: [],
      phaseBlocks: [],
    });
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        daily_summaries: {
          data: [
            {
              summary: {
                coachConversation: [{ role: 'athlete', text: 'foot hurts' }],
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
              training_recommendation: 'Easy run today.',
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
      expect(state.latestMessage).toBe('Easy run today.');
      expect(state.recommendations).toEqual(['Monday: Aerobic Run — base']);
      expect(state.cautions).toEqual(['Recovery trending down']);
      expect(state.rationale).toBe('Fatigue: manageable.');
      expect(state.conversation).toHaveLength(1);
      expect(state.followUp?.bodyPart).toBe('foot');
    }
  });

  it('returns empty state when athlete has a plan but no daily_summary for today', async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1', email: 's@test.com' });
    loadActiveTrainingPlan.mockResolvedValue({
      planId: 'plan-1',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      goal: null,
      weeklyStructure: [],
      phaseBlocks: [],
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
      expect(state.latestMessage).toBeNull();
      expect(state.recommendations).toEqual([]);
      expect(state.conversation).toEqual([]);
      expect(state.followUp).toBeNull();
    }
  });
});
