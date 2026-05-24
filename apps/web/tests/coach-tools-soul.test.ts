import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createProposalStore, executeCoachTool } from '../lib/agents/coach-tools';
import type { AthleteContext } from '../lib/agents/athlete-context';

vi.mock('../lib/profile/soul-writer', () => ({
  updateSoul: vi.fn(async (_s, args) => ({
    userId: args.userId,
    kind: args.kind,
    content: args.content,
    updatedBy: args.updatedBy,
    updatedAt: '2026-05-23T12:00:00Z',
  })),
}));

function makeCtx(overrides: Partial<AthleteContext> = {}): AthleteContext {
  const baseSoul = (kind: 'training' | 'longevity') => ({
    userId: 'user-1',
    kind,
    content: kind === 'training' ? 'morning runs only.' : 'attia + saladino frame health.',
    updatedBy: 'athlete' as const,
    updatedAt: '2026-05-20T10:00:00Z',
  });
  return {
    userId: 'user-1',
    today: '2026-05-23',
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
    currentPlan: null,
    recentWorkouts: [],
    recoveryHistory: [],
    injuryHistory: [],
    biomarkers: null,
    longevityContext: null,
    conversation: [],
    followUp: null,
    longevityConversation: [],
    trainingSoul: baseSoul('training'),
    longevitySoul: baseSoul('longevity'),
    ...overrides,
  };
}

const stubSupabase = {} as never;

describe('getTrainingSoul tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the loaded soul from context', async () => {
    const result = await executeCoachTool('getTrainingSoul', '{}', {
      ctx: makeCtx(),
      supabase: stubSupabase,
      proposalStore: createProposalStore(),
    });
    const parsed = JSON.parse(result);
    expect(parsed.soul.content).toBe('morning runs only.');
    expect(parsed.soul.kind).toBe('training');
  });
});

describe('updateTrainingSoul tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes content through to updateSoul with updated_by="training_coach"', async () => {
    const { updateSoul } = await import('../lib/profile/soul-writer');
    const args = JSON.stringify({ content: 'morning runs only. PR target: Boston.' });
    const result = await executeCoachTool('updateTrainingSoul', args, {
      ctx: makeCtx(),
      supabase: stubSupabase,
      proposalStore: createProposalStore(),
    });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.soul.content).toBe('morning runs only. PR target: Boston.');
    expect(parsed.soul.updatedBy).toBe('training_coach');
    const call = (updateSoul as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(call.updatedBy).toBe('training_coach');
    expect(call.kind).toBe('training');
  });

  it('returns ok:false when content is not a string', async () => {
    const args = JSON.stringify({ content: 42 });
    const result = await executeCoachTool('updateTrainingSoul', args, {
      ctx: makeCtx(),
      supabase: stubSupabase,
      proposalStore: createProposalStore(),
    });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/content/i);
  });
});
