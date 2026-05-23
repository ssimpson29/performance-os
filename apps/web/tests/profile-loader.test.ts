import { describe, expect, it, vi } from 'vitest';

import { isProfileCoachReady, loadAthleteProfile } from '../lib/profile/profile-loader';

/**
 * The loader contract: returns a profile shell with all nulls when no
 * users row exists, returns mapped/normalized fields when a row is
 * present, throws on supabase errors so transient outages don't get
 * masked as "no profile yet".
 */

type ChainResult = { data: unknown; error: { message: string } | null };

function supabaseReturning(result: ChainResult) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit', 'order']) {
    chain[m] = vi.fn(() => chain);
  }
  Object.assign(chain, {
    then: (resolve: (r: ChainResult) => void) => resolve(result),
  });
  // The loader chains `.from(...).select(...).eq(...).limit(...)`. Each
  // method returns the same chain object until awaited.
  return { from: vi.fn(() => chain) } as never;
}

describe('loadAthleteProfile', () => {
  it('returns an all-null profile shell when no users row exists', async () => {
    const supabase = supabaseReturning({ data: [], error: null });
    const profile = await loadAthleteProfile(supabase, 'user-1');
    expect(profile).toEqual({
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
    });
  });

  it('maps + normalizes a populated row', async () => {
    const supabase = supabaseReturning({
      data: [
        {
          id: 'user-1',
          display_name: 'Scott',
          timezone: 'America/Denver',
          date_of_birth: '1985-04-12',
          sex: 'M',                                     // exercise normalizeSex
          height_cm: '180.0',                            // string → number via toNumberOrNull
          weight_kg: 74.5,
          primary_goal: 'Place top 10 at Swiss Alps 100',
          experience_level: 'experienced',
          weekly_training_hours_baseline: '12.5',
          health_notes: 'mild asthma',
          onboarding_completed_at: '2026-05-20T10:00:00Z',
        },
      ],
      error: null,
    });

    const profile = await loadAthleteProfile(supabase, 'user-1');
    expect(profile.displayName).toBe('Scott');
    expect(profile.sex).toBe('male');
    expect(profile.heightCm).toBe(180);
    expect(profile.weightKg).toBe(74.5);
    expect(profile.weeklyTrainingHoursBaseline).toBe(12.5);
    expect(profile.experienceLevel).toBe('experienced');
    expect(profile.onboardingCompletedAt).toBe('2026-05-20T10:00:00Z');
  });

  it('normalizes unknown sex values to null instead of leaking through', async () => {
    const supabase = supabaseReturning({
      data: [{ id: 'user-1', sex: 'something-weird' }],
      error: null,
    });
    const profile = await loadAthleteProfile(supabase, 'user-1');
    expect(profile.sex).toBeNull();
  });

  it('normalizes unknown experience_level to null (defensive against schema drift)', async () => {
    const supabase = supabaseReturning({
      data: [{ id: 'user-1', experience_level: 'expert' }],
      error: null,
    });
    const profile = await loadAthleteProfile(supabase, 'user-1');
    expect(profile.experienceLevel).toBeNull();
  });

  it('throws on supabase error (so DB outages are not masked as empty profile)', async () => {
    const supabase = supabaseReturning({ data: null, error: { message: 'connection refused' } });
    await expect(loadAthleteProfile(supabase, 'user-1')).rejects.toThrow(/connection refused/);
  });
});

describe('isProfileCoachReady', () => {
  const baseProfile = {
    userId: 'user-1',
    displayName: 'Scott',
    timezone: 'UTC',
    dateOfBirth: '1985-04-12',
    sex: 'male' as const,
    heightCm: 180,
    weightKg: 74,
    primaryGoal: 'finish my first 100',
    experienceLevel: 'building' as const,
    weeklyTrainingHoursBaseline: 8,
    healthNotes: null,
    onboardingCompletedAt: '2026-05-20T10:00:00Z',
  };

  it('returns true when all required fields are present', () => {
    expect(isProfileCoachReady(baseProfile)).toBe(true);
  });

  it.each([
    ['heightCm', null],
    ['weightKg', null],
    ['dateOfBirth', null],
    ['primaryGoal', null],
    ['experienceLevel', null],
  ] as const)('returns false when %s is missing', (field, value) => {
    const profile = { ...baseProfile, [field]: value };
    expect(isProfileCoachReady(profile)).toBe(false);
  });
});
