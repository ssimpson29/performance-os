import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Athlete profile — the structured slice of public.users that the coach
 * reads to anchor its advice and that the onboarding form writes to.
 *
 * Schema source: supabase/migrations/002_core_schema.sql (basics) +
 * 009_onboarding_profile.sql (goal / experience / health_notes /
 * onboarding_completed_at).
 *
 * Every field is nullable on read because a brand-new athlete who hasn't
 * completed onboarding still has a `users` row (auto-created by the
 * 006_profile_creation.sql trigger) with every athletic field at NULL.
 * The loader returns a profile shell rather than throwing, so the
 * coach's no-profile branch can run cleanly.
 */
export type AthleteProfile = {
  userId: string;
  displayName: string | null;
  timezone: string | null;
  dateOfBirth: string | null;
  sex: 'male' | 'female' | null;
  heightCm: number | null;
  weightKg: number | null;
  primaryGoal: string | null;
  experienceLevel: 'beginner' | 'building' | 'experienced' | null;
  weeklyTrainingHoursBaseline: number | null;
  healthNotes: string | null;
  onboardingCompletedAt: string | null;
};

type UsersRow = {
  id: string;
  display_name: string | null;
  timezone: string | null;
  date_of_birth: string | null;
  sex: string | null;
  height_cm: number | string | null;
  weight_kg: number | string | null;
  primary_goal: string | null;
  experience_level: string | null;
  weekly_training_hours_baseline: number | string | null;
  health_notes: string | null;
  onboarding_completed_at: string | null;
};

function normalizeSex(raw: string | null): 'male' | 'female' | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (lower === 'male' || lower === 'm') return 'male';
  if (lower === 'female' || lower === 'f') return 'female';
  return null;
}

function normalizeExperience(
  raw: string | null,
): 'beginner' | 'building' | 'experienced' | null {
  if (raw === 'beginner' || raw === 'building' || raw === 'experienced') return raw;
  return null;
}

function toNumberOrNull(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read the athlete profile for `userId`. Returns a profile shell with
 * every athletic field at null if no users row exists yet (shouldn't
 * happen post-trigger, but we don't want a transient race to crash a
 * coach turn). Throws on supabase errors so the caller can log them —
 * a silent empty-shell on DB error would mask real outages.
 */
export async function loadAthleteProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<AthleteProfile> {
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, display_name, timezone, date_of_birth, sex, height_cm, weight_kg, primary_goal, experience_level, weekly_training_hours_baseline, health_notes, onboarding_completed_at',
    )
    .eq('id', userId)
    .limit(1);

  if (error) {
    throw new Error(`Failed to load athlete profile: ${error.message}`);
  }

  const row = (data as UsersRow[] | null)?.[0];
  if (!row) {
    return {
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
    };
  }

  return {
    userId: row.id,
    displayName: row.display_name,
    timezone: row.timezone,
    dateOfBirth: row.date_of_birth,
    sex: normalizeSex(row.sex),
    heightCm: toNumberOrNull(row.height_cm),
    weightKg: toNumberOrNull(row.weight_kg),
    primaryGoal: row.primary_goal,
    experienceLevel: normalizeExperience(row.experience_level),
    weeklyTrainingHoursBaseline: toNumberOrNull(row.weekly_training_hours_baseline),
    healthNotes: row.health_notes,
    onboardingCompletedAt: row.onboarding_completed_at,
  };
}

/**
 * True when the profile has all the minimum fields the coach needs to
 * reason about plan creation. Used by the coach prompt's new-athlete
 * branch to decide whether to ask gap-fill questions before suggesting
 * a plan. NOT used as a hard gate on the UI side — the form's submit
 * is what flips onboarding_completed_at.
 */
export function isProfileCoachReady(profile: AthleteProfile): boolean {
  return Boolean(
    profile.heightCm &&
      profile.weightKg &&
      profile.dateOfBirth &&
      profile.primaryGoal &&
      profile.experienceLevel,
  );
}
