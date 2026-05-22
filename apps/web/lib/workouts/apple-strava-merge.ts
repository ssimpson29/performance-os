import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingMatch, type WorkoutLike } from './duplicate-matching';

/**
 * Phase 3 of the Strava integration (see docs/plans/2026-05-22-strava-integration.md):
 * after an Apple Health / Apple Watch workout is upserted, look for a
 * pre-existing Strava-sourced row that describes the same training session,
 * and resolve the duplicate the same way the Strava sync does on the
 * opposite ordering — the Apple row stays canonical, the Strava row's
 * `superseded_by` points at the Apple row, and the Strava description (if
 * present) gets forwarded onto the Apple row.
 *
 * This module is pure orchestration; the matching rule lives in
 * `duplicate-matching.ts` so both directions share the same definition of
 * "same session".
 */

export type AppleRowForMerge = {
  id: string;
  source: 'apple_health' | 'apple_watch';
  external_id: string;
  workout_type: string;
  started_at: string;
  duration_seconds: number | null;
  description: string | null;
};

type StravaRow = {
  id: string;
  workout_type: string;
  started_at: string;
  duration_seconds: number | null;
  description: string | null;
  superseded_by: string | null;
};

export type AppleStravaMergeResult = {
  linkedStravaRows: number;
  forwardedDescriptions: number;
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * For each Apple row in the batch, find a still-canonical Strava workout
 * that matches the same session, set its `superseded_by` to the Apple row,
 * and forward its description onto the Apple row when the Apple row didn't
 * have one yet.
 *
 * No-op when `appleRows` is empty.
 */
export async function linkAppleRowsToStravaMatches(
  supabase: SupabaseClient,
  args: { userId: string; appleRows: AppleRowForMerge[] },
): Promise<AppleStravaMergeResult> {
  const { userId, appleRows } = args;
  if (appleRows.length === 0) {
    return { linkedStravaRows: 0, forwardedDescriptions: 0 };
  }

  // Pull existing Strava rows in the relevant time window. Pad ±5 minutes so
  // we catch boundary cases (matcher uses ±120s, but Strava and Apple can
  // record slightly different start timestamps).
  const earliestMs = appleRows.reduce(
    (acc, row) => Math.min(acc, new Date(row.started_at).getTime()),
    Number.POSITIVE_INFINITY,
  );
  const latestMs = appleRows.reduce(
    (acc, row) => Math.max(acc, new Date(row.started_at).getTime()),
    Number.NEGATIVE_INFINITY,
  );
  const fromIso = new Date(earliestMs - FIVE_MINUTES_MS).toISOString();
  const toIso = new Date(latestMs + FIVE_MINUTES_MS).toISOString();

  const { data: stravaData, error: stravaErr } = await supabase
    .from('workouts')
    .select('id, workout_type, started_at, duration_seconds, description, superseded_by')
    .eq('user_id', userId)
    .eq('source', 'strava')
    .is('superseded_by', null)
    .gte('started_at', fromIso)
    .lte('started_at', toIso);

  if (stravaErr) {
    // Surface as a thrown error — the caller (importActualWorkouts) already
    // throws on persistence failures, so this matches the existing
    // failure-mode contract.
    throw new Error(`apple-strava-merge: failed to load Strava rows: ${stravaErr.message}`);
  }

  const stravaRows: StravaRow[] = (stravaData as StravaRow[] | null) ?? [];
  if (stravaRows.length === 0) {
    return { linkedStravaRows: 0, forwardedDescriptions: 0 };
  }

  // Track which Strava rows we've already linked in this batch so the same
  // Strava row can't be claimed twice (e.g. if two Apple rows accidentally
  // sit within the matcher's window of one Strava row).
  const claimedStravaIds = new Set<string>();
  let linked = 0;
  let forwarded = 0;

  for (const apple of appleRows) {
    const candidate: WorkoutLike = {
      startedAt: apple.started_at,
      durationSeconds: apple.duration_seconds,
      workoutType: apple.workout_type,
      source: apple.source,
      id: apple.id,
    };
    const available = stravaRows
      .filter((s) => !claimedStravaIds.has(s.id))
      .map<WorkoutLike & { id: string; description: string | null }>((s) => ({
        id: s.id,
        startedAt: s.started_at,
        durationSeconds: s.duration_seconds,
        workoutType: s.workout_type,
        source: 'strava',
        description: s.description,
      }));
    const matched = findExistingMatch(candidate, available);
    if (!matched) continue;

    claimedStravaIds.add(matched.id as string);

    // Link the Strava row to the canonical Apple row.
    const { error: linkErr } = await supabase
      .from('workouts')
      .update({ superseded_by: apple.id })
      .eq('id', matched.id as string);
    if (linkErr) {
      throw new Error(`apple-strava-merge: failed to link Strava row ${matched.id}: ${linkErr.message}`);
    }
    linked += 1;

    // Forward the Strava description onto the Apple row when the Apple row
    // doesn't have its own description yet.
    const stravaDescription = (matched as { description: string | null }).description;
    if (stravaDescription && !apple.description) {
      const { error: descErr } = await supabase
        .from('workouts')
        .update({ description: stravaDescription })
        .eq('id', apple.id);
      if (descErr) {
        throw new Error(`apple-strava-merge: failed to forward description to Apple row ${apple.id}: ${descErr.message}`);
      }
      forwarded += 1;
    }
  }

  return { linkedStravaRows: linked, forwardedDescriptions: forwarded };
}
