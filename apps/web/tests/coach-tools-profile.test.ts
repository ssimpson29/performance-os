import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeCoachTool, createProposalStore } from '../lib/agents/coach-tools';
import type { AthleteContext } from '../lib/agents/athlete-context';

vi.mock('../lib/profile/profile-writer', () => ({
  upsertAthleteProfile: vi.fn(async (_s: unknown, userId: string, patch: Record<string, unknown>) => ({
    userId,
    displayName: null,
    timezone: null,
    dateOfBirth: null,
    sex: null,
    heightCm: null,
    weightKg: null,
    primaryGoal: null,
    experienceLevel: null,
    weeklyTrainingHoursBaseline: null,
    healthNotes: null,
    onboardingCompletedAt: null,
    ...patch,
  })),
}));

function makeCtx(overrides: Partial<AthleteContext> = {}): AthleteContext {
  return {
    userId: 'user-1',
    today: '2026-05-23',
    profile: {
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
    },
    currentPlan: null,
    recentWorkouts: [],
    recoveryHistory: [],
    injuryHistory: [],
    biomarkers: null,
    longevityContext: null,
    conversation: [],
    followUp: null,
    longevityConversation: [],
    trainingSoul: {
      userId: 'user-1',
      kind: 'training' as const,
      content: '',
      updatedBy: 'athlete' as const,
      updatedAt: null,
    },
    longevitySoul: {
      userId: 'user-1',
      kind: 'longevity' as const,
      content: '',
      updatedBy: 'athlete' as const,
      updatedAt: null,
    },
    ...overrides,
  };
}

const stubSupabase = {} as never;

describe('getAthleteProfile tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the loaded profile slice from the context', async () => {
    const ctx = makeCtx();
    const result = await executeCoachTool('getAthleteProfile', '{}', {
      ctx,
      supabase: stubSupabase,
      proposalStore: createProposalStore(),
    });
    const parsed = JSON.parse(result);
    expect(parsed.profile.heightCm).toBe(180);
    expect(parsed.profile.primaryGoal).toBe('Place top 10 at Swiss Alps 100');
    expect(parsed.profile.experienceLevel).toBe('experienced');
  });

  it('returns an athlete with mostly-null fields when onboarding is incomplete', async () => {
    const ctx = makeCtx({
      profile: {
        userId: 'user-1',
        displayName: null,
        timezone: null,
        dateOfBirth: null,
        sex: null,
        heightCm: null,
        weightKg: null,
        primaryGoal: null,
        experienceLevel: null,
        weeklyTrainingHoursBaseline: null,
        healthNotes: null,
        onboardingCompletedAt: null,
      },
    });
    const result = await executeCoachTool('getAthleteProfile', '{}', {
      ctx,
      supabase: stubSupabase,
      proposalStore: createProposalStore(),
    });
    const parsed = JSON.parse(result);
    expect(parsed.profile.heightCm).toBeNull();
    expect(parsed.profile.onboardingCompletedAt).toBeNull();
  });
});

describe('recordAthleteProfile tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the patch through to upsertAthleteProfile and returns updated profile', async () => {
    const ctx = makeCtx();
    const args = JSON.stringify({ heightCm: 182, primaryGoal: 'PR my marathon' });
    const result = await executeCoachTool('recordAthleteProfile', args, {
      ctx,
      supabase: stubSupabase,
      proposalStore: createProposalStore(),
    });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.profile.heightCm).toBe(182);
    expect(parsed.profile.primaryGoal).toBe('PR my marathon');
  });

  it('drops unknown keys defensively (LLM occasionally hallucinates)', async () => {
    const { upsertAthleteProfile } = await import('../lib/profile/profile-writer');
    const ctx = makeCtx();
    const args = JSON.stringify({
      heightCm: 182,
      arbitraryHallucinatedField: 'nope',
      shoeBrand: 'altra',
    });
    await executeCoachTool('recordAthleteProfile', args, {
      ctx,
      supabase: stubSupabase,
      proposalStore: createProposalStore(),
    });
    expect(upsertAthleteProfile).toHaveBeenCalled();
    const patch = (upsertAthleteProfile as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(patch).not.toHaveProperty('arbitraryHallucinatedField');
    expect(patch).not.toHaveProperty('shoeBrand');
  });
});
