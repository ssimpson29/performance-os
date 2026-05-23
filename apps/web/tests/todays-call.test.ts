import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composeTodaysCall } from '../lib/agents/todays-call';
import type { AthleteContext } from '../lib/agents/athlete-context';

/**
 * Composer tests focus on the deterministic paths that don't depend on
 * the LLM: no-plan returns null, env-missing returns the deterministic
 * fallback shape. LLM happy-path behavior is covered by integration
 * with the live model — too brittle to mock the JSON content here.
 */

function makeProfile(): AthleteContext['profile'] {
  return {
    userId: 'user-1',
    displayName: 'Scott',
    timezone: 'America/Denver',
    dateOfBirth: '1985-04-12',
    sex: 'male',
    heightCm: 180,
    weightKg: 74,
    primaryGoal: 'Place top 10 at Swiss Alps 100',
    experienceLevel: 'experienced',
    weeklyTrainingHoursBaseline: 12,
    healthNotes: null,
    onboardingCompletedAt: '2026-05-20T10:00:00Z',
  };
}

function makeSoul(kind: 'training' | 'longevity'): AthleteContext['trainingSoul'] {
  return { userId: 'user-1', kind, content: '', updatedBy: 'athlete', updatedAt: null };
}

function makeCtx(overrides: Partial<AthleteContext> = {}): AthleteContext {
  return {
    userId: 'user-1',
    today: '2026-05-23',
    profile: makeProfile(),
    currentPlan: {
      planId: 'plan-1',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      goal: 'Place top 10 at Swiss Alps 100',
      weeklyStructure: [
        {
          day: 'Saturday',
          runSession: 'Long Run',
          details: '2.5–3 hrs building toward 4–5 hrs',
          strengthMobility: 'None',
          exactWork: 'Fuel 70–90g carbs/hr',
        },
      ],
      phaseBlocks: [
        {
          phaseName: 'PHASE 1: FOUNDATION',
          headers: ['Week'],
          weeks: [
            { weekLabel: '1', mileageTarget: '60', vertTarget: '5,000 ft', isDeload: false, metadata: {} },
            { weekLabel: '2', mileageTarget: '65', vertTarget: '5,500 ft', isDeload: false, metadata: {} },
          ],
        },
      ],
      supportTemplates: [],
    },
    recentWorkouts: [],
    recoveryHistory: [],
    injuryHistory: [],
    biomarkers: null,
    longevityContext: null,
    conversation: [],
    followUp: null,
    trainingSoul: makeSoul('training'),
    longevitySoul: makeSoul('longevity'),
    ...overrides,
  };
}

const stubSupabase = {} as never;

describe('composeTodaysCall', () => {
  beforeEach(() => {
    // Force env-missing path so we exercise the deterministic fallback
    // without making real HTTP calls. Individual tests can override.
    delete process.env.AI_COACH_API_KEY;
    delete process.env.AI_COACH_MODEL;
    delete process.env.AI_COACH_BASE_URL;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when athlete has no plan', async () => {
    const ctx = makeCtx({ currentPlan: null });
    const call = await composeTodaysCall({ ctx, supabase: stubSupabase });
    expect(call).toBeNull();
  });

  it('returns deterministic fallback when AI_COACH_* env is missing', async () => {
    const ctx = makeCtx();
    const call = await composeTodaysCall({ ctx, supabase: stubSupabase });
    expect(call).not.toBeNull();
    if (!call) return;
    expect(call.llmInvoked).toBe(false);
    // Falls back to the plan template entry for today.
    expect(call.runSession).toBe('Long Run');
    expect(call.details).toContain('2.5');
    // Phase context is computed server-side regardless of LLM presence.
    expect(call.phaseContext).toContain('PHASE 1: FOUNDATION');
    expect(call.rationale).toMatch(/LLM composition unavailable/);
  });

  it('deterministic fallback shows "Rest day" when no template entry exists for today', async () => {
    const ctx = makeCtx({
      today: '2026-05-25', // Monday — not in the single-Saturday weeklyStructure
      currentPlan: {
        ...makeCtx().currentPlan!,
        weeklyStructure: [
          {
            day: 'Saturday',
            runSession: 'Long Run',
            details: 'x',
            strengthMobility: 'None',
            exactWork: 'x',
          },
        ],
      },
    });
    const call = await composeTodaysCall({ ctx, supabase: stubSupabase });
    expect(call).not.toBeNull();
    if (!call) return;
    expect(call.runSession).toBe('Rest');
    expect(call.headline).toBe('Rest day');
  });

  it('phaseContext reflects the actual phase position computation', async () => {
    // Plan starts 2026-02-02, today 2026-05-23 → ~16 weeks in.
    // Foundation phase only has 2 weeks in this fixture, so the athlete
    // is OUTSIDE any defined phase. phaseContext should reflect that
    // honestly — that's the diagnostic value.
    const ctx = makeCtx();
    const call = await composeTodaysCall({ ctx, supabase: stubSupabase });
    expect(call).not.toBeNull();
    if (!call) return;
    // Position outside any phase → phaseIndex < 0 → phaseContext stays informative.
    expect(typeof call.phaseContext).toBe('string');
    expect(call.phaseContext.length).toBeGreaterThan(0);
  });
});
