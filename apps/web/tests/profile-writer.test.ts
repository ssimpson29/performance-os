import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  markOnboardingComplete,
  upsertAthleteProfile,
} from '../lib/profile/profile-writer';

vi.mock('../lib/profile/profile-loader', () => ({
  loadAthleteProfile: vi.fn(async (_supabase: unknown, userId: string) => ({
    userId,
    displayName: 'Scott',
    timezone: 'America/Denver',
    dateOfBirth: '1985-04-12',
    sex: 'male' as const,
    heightCm: 180,
    weightKg: 74,
    primaryGoal: 'finish',
    experienceLevel: 'building' as const,
    weeklyTrainingHoursBaseline: 8,
    healthNotes: null,
    onboardingCompletedAt: null,
  })),
}));

type CapturedUpdate = { payload: Record<string, unknown>; userId: string };

function captureSupabase(captured: CapturedUpdate[]) {
  const eqFn = vi.fn((_col: string, userId: string) => {
    captured[captured.length - 1].userId = userId;
    return { then: (resolve: (r: { error: null }) => void) => resolve({ error: null }) };
  });
  const update = vi.fn((payload: Record<string, unknown>) => {
    captured.push({ payload, userId: '' });
    return { eq: eqFn };
  });
  return { from: vi.fn(() => ({ update })) } as never;
}

describe('upsertAthleteProfile', () => {
  let captured: CapturedUpdate[];

  beforeEach(() => {
    captured = [];
  });

  it('writes only the columns present in the patch (preserves untouched fields)', async () => {
    const supabase = captureSupabase(captured);
    await upsertAthleteProfile(supabase, 'user-1', { heightCm: 180, primaryGoal: 'top 10' });

    expect(captured).toHaveLength(1);
    expect(captured[0].userId).toBe('user-1');
    expect(captured[0].payload).toMatchObject({
      height_cm: 180,
      primary_goal: 'top 10',
    });
    // No other profile columns should be in the payload — confirms partial update.
    expect(captured[0].payload).not.toHaveProperty('weight_kg');
    expect(captured[0].payload).not.toHaveProperty('date_of_birth');
    expect(captured[0].payload).not.toHaveProperty('sex');
    // updated_at is always set so RLS/trigger-driven audit columns stay current.
    expect(captured[0].payload.updated_at).toBeDefined();
  });

  it('maps camelCase patch keys to snake_case column names', async () => {
    const supabase = captureSupabase(captured);
    await upsertAthleteProfile(supabase, 'user-1', {
      dateOfBirth: '1985-04-12',
      weeklyTrainingHoursBaseline: 12.5,
      healthNotes: 'asthma',
      experienceLevel: 'experienced',
    });

    expect(captured[0].payload).toMatchObject({
      date_of_birth: '1985-04-12',
      weekly_training_hours_baseline: 12.5,
      health_notes: 'asthma',
      experience_level: 'experienced',
    });
  });

  it('treats an empty patch as a no-op (no DB write)', async () => {
    const supabase = captureSupabase(captured);
    await upsertAthleteProfile(supabase, 'user-1', {});
    expect(captured).toHaveLength(0);
  });

  it('throws when supabase update fails', async () => {
    const failing = {
      from: () => ({
        update: () => ({
          eq: () => ({
            then: (resolve: (r: { error: { message: string } }) => void) =>
              resolve({ error: { message: 'permission denied' } }),
          }),
        }),
      }),
    } as never;
    await expect(
      upsertAthleteProfile(failing, 'user-1', { heightCm: 180 }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('markOnboardingComplete', () => {
  it('sets onboarding_completed_at + updated_at to ISO timestamps', async () => {
    const captured: CapturedUpdate[] = [];
    const supabase = captureSupabase(captured);
    await markOnboardingComplete(supabase, 'user-1');

    expect(captured).toHaveLength(1);
    expect(captured[0].userId).toBe('user-1');
    const payload = captured[0].payload;
    expect(typeof payload.onboarding_completed_at).toBe('string');
    expect(payload.onboarding_completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.updated_at).toBe(payload.onboarding_completed_at);
  });

  it('throws when the update fails', async () => {
    const failing = {
      from: () => ({
        update: () => ({
          eq: () => ({
            then: (resolve: (r: { error: { message: string } }) => void) =>
              resolve({ error: { message: 'connection lost' } }),
          }),
        }),
      }),
    } as never;
    await expect(markOnboardingComplete(failing, 'user-1')).rejects.toThrow(/connection lost/);
  });
});
