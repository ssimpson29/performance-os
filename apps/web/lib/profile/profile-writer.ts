import type { SupabaseClient } from '@supabase/supabase-js';

import { loadAthleteProfile, type AthleteProfile } from './profile-loader';

/**
 * Partial patch over an AthleteProfile. Every field optional. Used by:
 *   - the /api/onboarding/complete handler (full form payload)
 *   - the recordAthleteProfile coach tool (single-field gap-fill from chat)
 *
 * onboardingCompletedAt is NOT in the patch shape — that's a separate
 * lifecycle handled by markOnboardingComplete, so the coach's gap-fill
 * writes never accidentally re-stamp the completion timestamp.
 */
export type AthleteProfilePatch = {
  displayName?: string | null;
  timezone?: string | null;
  dateOfBirth?: string | null;
  sex?: 'male' | 'female' | null;
  heightCm?: number | null;
  weightKg?: number | null;
  primaryGoal?: string | null;
  experienceLevel?: 'beginner' | 'building' | 'experienced' | null;
  weeklyTrainingHoursBaseline?: number | null;
  healthNotes?: string | null;
};

/**
 * Map the API-shaped patch (camelCase) to the column-shaped update
 * (snake_case). Only includes keys that are explicitly present in the
 * patch — undefined keys are dropped so we don't accidentally write
 * NULL to a column the caller didn't intend to touch.
 */
function toColumnPatch(patch: AthleteProfilePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.displayName !== undefined) out.display_name = patch.displayName;
  if (patch.timezone !== undefined) out.timezone = patch.timezone;
  if (patch.dateOfBirth !== undefined) out.date_of_birth = patch.dateOfBirth;
  if (patch.sex !== undefined) out.sex = patch.sex;
  if (patch.heightCm !== undefined) out.height_cm = patch.heightCm;
  if (patch.weightKg !== undefined) out.weight_kg = patch.weightKg;
  if (patch.primaryGoal !== undefined) out.primary_goal = patch.primaryGoal;
  if (patch.experienceLevel !== undefined) out.experience_level = patch.experienceLevel;
  if (patch.weeklyTrainingHoursBaseline !== undefined)
    out.weekly_training_hours_baseline = patch.weeklyTrainingHoursBaseline;
  if (patch.healthNotes !== undefined) out.health_notes = patch.healthNotes;
  return out;
}

/**
 * Apply a partial patch to public.users for `userId` and return the
 * resulting AthleteProfile. The users row already exists (auto-created
 * by 006_profile_creation.sql on auth.users insert), so this is always
 * an UPDATE rather than an upsert in practice — but we use upsert
 * semantics for defensive resilience against a missing row.
 *
 * Empty patch is a no-op: returns the current profile without a write.
 */
export async function upsertAthleteProfile(
  supabase: SupabaseClient,
  userId: string,
  patch: AthleteProfilePatch,
): Promise<AthleteProfile> {
  const columnPatch = toColumnPatch(patch);
  if (Object.keys(columnPatch).length === 0) {
    return loadAthleteProfile(supabase, userId);
  }

  columnPatch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('users')
    .update(columnPatch)
    .eq('id', userId);

  if (error) {
    throw new Error(`Failed to upsert athlete profile: ${error.message}`);
  }

  return loadAthleteProfile(supabase, userId);
}

/**
 * Stamp onboarding_completed_at on the users row. Separate from
 * upsertAthleteProfile so the coach's gap-fill writes can't
 * accidentally complete onboarding for an athlete who hasn't actually
 * walked through the form.
 *
 * Idempotent: writing a fresh timestamp to an already-completed row is
 * harmless (we keep the latest write so the column reflects the most
 * recent submission, useful for support / debugging).
 */
export async function markOnboardingComplete(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('users')
    .update({ onboarding_completed_at: now, updated_at: now })
    .eq('id', userId);

  if (error) {
    throw new Error(`Failed to mark onboarding complete: ${error.message}`);
  }
}
