import { describe, expect, it } from 'vitest';

import type { AthleteContext } from '../lib/agents/athlete-context';
import { buildSystemPrompt } from '../lib/agents/training-coach';
import type { ActiveTrainingPlanContext } from '../app/plan/coach-data';

/**
 * Tests for the posture-aware system prompt. We don't assert exact text
 * (that would freeze the wording) — we assert that the right anchors are
 * present so the LLM has the right instructions to lean on. If you change
 * a posture's behavior, update the corresponding assertion below.
 */

function makePlan(overrides: Partial<ActiveTrainingPlanContext> = {}): ActiveTrainingPlanContext {
  return {
    planId: 'plan-1',
    planStartDate: '2026-02-02',
    raceDate: '2026-08-07',
    goal: null,
    weeklyStructure: [],
    phaseBlocks: [],
    supportTemplates: [],
    ...overrides,
  };
}

function makeProfile(overrides: Partial<AthleteContext['profile']> = {}): AthleteContext['profile'] {
  return {
    userId: 'user-1',
    displayName: 'Scott',
    timezone: 'America/Denver',
    dateOfBirth: '1985-04-12',
    sex: 'male',
    heightCm: 180,
    weightKg: 74,
    primaryGoal: null,
    experienceLevel: 'experienced',
    weeklyTrainingHoursBaseline: 12,
    healthNotes: null,
    onboardingCompletedAt: '2026-05-20T10:00:00Z',
    ...overrides,
  };
}

function makeSoul(
  kind: 'training' | 'longevity',
  overrides: Partial<AthleteContext['trainingSoul']> = {},
): AthleteContext['trainingSoul'] {
  return {
    userId: 'user-1',
    kind,
    content: '',
    updatedBy: 'athlete',
    updatedAt: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<AthleteContext> = {}): AthleteContext {
  return {
    userId: 'user-1',
    today: '2026-05-23',
    profile: makeProfile(),
    currentPlan: null,
    recentWorkouts: [],
    recoveryHistory: [],
    injuryHistory: [],
    biomarkers: null,
    longevityContext: null,
    conversation: [],
    followUp: null,
    longevityConversation: [],
    trainingSoul: makeSoul('training'),
    longevitySoul: makeSoul('longevity'),
    ...overrides,
  };
}

describe('buildSystemPrompt — posture-aware', () => {
  it('AGGRESSIVE: surfaces posture + advocates concretely on raise + treats over-performance as opportunity', () => {
    const prompt = buildSystemPrompt(
      makeContext({
        currentPlan: makePlan({
          goal: 'place top 10 in the Swiss Alps 100',
          raceContext: { raceName: 'Swiss Alps 100', raceDate: '2026-08-07', goal: 'top 10' },
        }),
      }),
    );
    expect(prompt).toMatch(/Coaching posture: AGGRESSIVE/);
    expect(prompt).toContain('place top 10 in the Swiss Alps 100');
    // Advocates concretely on raise:
    expect(prompt).toMatch(/planAdaptation\.suggestion === 'raise'/);
    expect(prompt).toMatch(/advocate/i);
    expect(prompt).toMatch(/volumeDelta/);
    // Treats over-performance as primary signal:
    expect(prompt).toMatch(/handling extra load well/i);
    expect(prompt).toMatch(/PRIMARY SIGNAL/);
    // Allows disagreement with engine on the "push" side:
    expect(prompt).toMatch(/disagree with a "hold"/);
    // Hard floors still respected:
    expect(prompt).toMatch(/fatigueState of 'high'/);
  });

  it('CONSERVATIVE: surfaces posture + biases toward patience / "let this consolidate"', () => {
    const prompt = buildSystemPrompt(
      makeContext({
        currentPlan: makePlan({ goal: 'just want to finish my first half marathon' }),
      }),
    );
    expect(prompt).toMatch(/Coaching posture: CONSERVATIVE/);
    expect(prompt).toContain('just want to finish my first half marathon');
    expect(prompt).toMatch(/Defend the plan|patience/i);
    expect(prompt).toMatch(/consolidate/i);
  });

  it('BALANCED: standard posture, no advocacy bias either direction', () => {
    const prompt = buildSystemPrompt(
      makeContext({ currentPlan: makePlan({ goal: 'run the Swiss Alps 100' }) }),
    );
    expect(prompt).toMatch(/Coaching posture: BALANCED/);
    expect(prompt).toMatch(/face value/i);
  });

  it('honors explicit posture override over goal-text inference', () => {
    const prompt = buildSystemPrompt(
      makeContext({
        currentPlan: makePlan({
          goal: 'just finish',
          coachingPosture: 'aggressive',
        }),
      }),
    );
    // Goal says "just finish" → would infer conservative — but explicit
    // override pins aggressive.
    expect(prompt).toMatch(/Coaching posture: AGGRESSIVE/);
  });

  it('falls back to BALANCED when there is no plan at all', () => {
    const prompt = buildSystemPrompt(makeContext({ currentPlan: null }));
    expect(prompt).toMatch(/Coaching posture: BALANCED/);
    expect(prompt).toContain('No active training plan on record.');
  });

  it('still includes the injury-bias instruction regardless of posture', () => {
    const prompt = buildSystemPrompt(
      makeContext({
        currentPlan: makePlan({ goal: 'place top 10 in the Swiss Alps 100' }),
      }),
    );
    // Even aggressive plans respect acute injury signals.
    expect(prompt).toMatch(/Injury \/ pain reports/);
    expect(prompt).toMatch(/REGARDLESS of posture/);
  });

  it('includes the "I\'m handling more than the plan" behavior with posture-tailored response', () => {
    const prompt = buildSystemPrompt(
      makeContext({
        currentPlan: makePlan({ goal: 'place top 10 in the Swiss Alps 100' }),
      }),
    );
    expect(prompt).toMatch(/handling more than the plan/i);
    expect(prompt).toMatch(/aggressive\s*[→-]\s*advocate/i);
    expect(prompt).toMatch(/conservative\s*[→-]\s*validate but counsel patience/i);
  });
});

describe('buildSystemPrompt — new-athlete branch + profile surface', () => {
  it('surfaces athlete profile fields inline (so LLM does not re-ask for height / weight / DOB)', () => {
    const prompt = buildSystemPrompt(
      makeContext({
        profile: makeProfile({
          heightCm: 178,
          weightKg: 72,
          dateOfBirth: '1990-06-15',
          sex: 'female',
          experienceLevel: 'building',
          weeklyTrainingHoursBaseline: 8,
          healthNotes: 'mild asthma',
        }),
      }),
    );
    expect(prompt).toContain('178cm');
    expect(prompt).toContain('72kg');
    expect(prompt).toContain('1990-06-15');
    expect(prompt).toContain('female');
    expect(prompt).toContain('building');
    expect(prompt).toContain('8h/wk');
    expect(prompt).toContain('mild asthma');
    expect(prompt).toMatch(/onboarded/);
  });

  it('marks profile as NOT onboarded when onboardingCompletedAt is null', () => {
    const prompt = buildSystemPrompt(
      makeContext({
        profile: makeProfile({ onboardingCompletedAt: null }),
      }),
    );
    expect(prompt).toMatch(/NOT onboarded/);
  });

  it('falls back to profile primaryGoal for the goal line when no plan exists', () => {
    const prompt = buildSystemPrompt(
      makeContext({
        currentPlan: null,
        profile: makeProfile({ primaryGoal: 'Place top 10 at Swiss Alps 100' }),
      }),
    );
    expect(prompt).toContain('Place top 10 at Swiss Alps 100');
    expect(prompt).toMatch(/from profile, no plan yet/);
    // Posture inferred from profile goal text → AGGRESSIVE.
    expect(prompt).toMatch(/Coaching posture: AGGRESSIVE/);
  });

  it('includes the new-athlete plan-building behavior block', () => {
    const prompt = buildSystemPrompt(makeContext({ currentPlan: null }));
    expect(prompt).toMatch(/New athlete .* no plan AND profile thin or missing/);
    expect(prompt).toMatch(/getAthleteProfile FIRST/);
    expect(prompt).toMatch(/recordAthleteProfile/);
    expect(prompt).toMatch(/proposeRacePlan/);
    expect(prompt).toMatch(/commitTrainingPlan/);
    expect(prompt).toMatch(/explicit "yes/);
    // Don't blast all questions at once.
    expect(prompt).toMatch(/1.{0,2}2 questions per turn/);
  });
});

describe('buildSystemPrompt — athlete souls', () => {
  it('renders empty-content placeholders when both souls are empty', () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain('=== ATHLETE SOUL (training)');
    expect(prompt).toContain('=== ATHLETE SOUL (longevity, read-only here)');
    expect(prompt).toMatch(/\(empty — no facts recorded yet\)/);
    expect(prompt).toMatch(/never updated/);
  });

  it('renders both souls with content + metadata when populated', () => {
    const prompt = buildSystemPrompt(
      makeContext({
        trainingSoul: makeSoul('training', {
          content: 'morning runs only. hate the treadmill.',
          updatedBy: 'training_coach',
          updatedAt: '2026-05-22T10:00:00Z',
        }),
        longevitySoul: makeSoul('longevity', {
          content: 'attia + saladino frame health advice.',
          updatedBy: 'athlete',
          updatedAt: '2026-05-20T09:30:00Z',
        }),
      }),
    );
    expect(prompt).toContain('morning runs only. hate the treadmill.');
    expect(prompt).toContain('attia + saladino frame health advice.');
    expect(prompt).toContain('last updated 2026-05-22 by training_coach');
    expect(prompt).toContain('last updated 2026-05-20 by athlete');
  });

  it('always tells the LLM to call updateTrainingSoul on new durable facts + preserve existing', () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toMatch(/updateTrainingSoul/);
    expect(prompt).toMatch(/PRESERVING all existing facts|preserve existing facts/i);
    expect(prompt).toMatch(/durable fact/i);
  });
});
