import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runLongevityChat } from '../lib/agents/longevity-chat';
import type { AthleteContext } from '../lib/agents/athlete-context';

/**
 * Chat-loop tests focus on the deterministic paths that don't require
 * an LLM mock: env-missing fallback message shape, conversation
 * append + trim behavior, soulUpdated flag plumbing when no tool is
 * called. LLM tool-calling happy paths are integration territory.
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
    primaryGoal: null,
    experienceLevel: 'experienced',
    weeklyTrainingHoursBaseline: 12,
    healthNotes: null,
    onboardingCompletedAt: '2026-05-20T10:00:00Z',
  };
}

function makeSoul(kind: 'training' | 'longevity'): AthleteContext['trainingSoul'] {
  return {
    userId: 'user-1',
    kind,
    content: '',
    updatedBy: 'athlete',
    updatedAt: null,
  };
}

function makeCtx(overrides: Partial<AthleteContext> = {}): AthleteContext {
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

const stubSupabase = {} as never;

describe('runLongevityChat', () => {
  beforeEach(() => {
    // Force env-missing so the deterministic fallback fires without
    // any real HTTP traffic.
    delete process.env.AI_COACH_API_KEY;
    delete process.env.AI_COACH_MODEL;
    delete process.env.AI_COACH_BASE_URL;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('env-missing: returns deterministic fallback message + llmInvoked false', async () => {
    const result = await runLongevityChat({
      today: '2026-05-23',
      athleteMessage: 'What does my anion gap of 6 mean?',
      athleteContext: makeCtx(),
      supabase: stubSupabase,
    });

    expect(result.llmInvoked).toBe(false);
    expect(result.soulUpdated).toBe(false);
    expect(result.toolTrace).toEqual([]);
    expect(result.message).toMatch(/anion gap of 6/i); // echoes the question
    // Conversation now includes the athlete turn + the fallback guru turn.
    expect(result.conversation).toHaveLength(2);
    expect(result.conversation[0]).toMatchObject({ role: 'athlete' });
    expect(result.conversation[1]).toMatchObject({ role: 'guru' });
  });

  it('empty message: still produces a fallback "give me your read" response', async () => {
    const result = await runLongevityChat({
      today: '2026-05-23',
      athleteMessage: '',
      athleteContext: makeCtx(),
      supabase: stubSupabase,
    });
    expect(result.llmInvoked).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
    // Empty athleteMessage means we ONLY append the guru turn.
    expect(result.conversation).toHaveLength(1);
    expect(result.conversation[0]).toMatchObject({ role: 'guru' });
  });

  it('preserves prior conversation history (trims to last 20 turns)', async () => {
    const priorTurns: AthleteContext['longevityConversation'] = Array.from(
      { length: 25 },
      (_, i) => ({
        role: i % 2 === 0 ? 'athlete' : 'guru',
        text: `turn ${i}`,
        at: `2026-05-${String(20 + (i % 3)).padStart(2, '0')}T10:00:00Z`,
      }),
    );

    const result = await runLongevityChat({
      today: '2026-05-23',
      athleteMessage: 'new question',
      athleteContext: makeCtx({ longevityConversation: priorTurns }),
      supabase: stubSupabase,
    });
    // 25 prior + 1 athlete + 1 guru = 27, trimmed to 20.
    expect(result.conversation).toHaveLength(20);
    // Last two should be this turn's athlete + guru.
    expect(result.conversation[result.conversation.length - 2]).toMatchObject({
      role: 'athlete',
      text: 'new question',
    });
    expect(result.conversation[result.conversation.length - 1]).toMatchObject({
      role: 'guru',
    });
  });
});
