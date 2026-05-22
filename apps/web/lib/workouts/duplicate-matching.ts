/**
 * Pure duplicate-detection helpers for incoming workouts from multiple
 * sources (Apple Health / Apple Watch / Strava / manual). See
 * docs/plans/2026-05-22-strava-integration.md for design context.
 *
 * Architecture: one DB row per source survives so we don't lose
 * source-specific richness. A `superseded_by` column on the workouts table
 * marks non-canonical duplicates; downstream readers filter to canonical
 * rows. Source precedence — Apple-sourced rows win for metrics (HR,
 * distance, duration, etc.); Strava wins for the written description.
 * The route handler is the one that decides who wins and writes the link.
 * This module's only job is "are these two records the same training
 * session?" — pure, testable, no DB.
 */

export type WorkoutFamily = 'run' | 'bike' | 'walk' | 'hike' | 'strength' | 'other';

/**
 * Normalize a free-form workout type string (Strava, Apple Health, manual
 * entry — they all use different vocabularies) to a coarse family the
 * matcher can compare.
 */
export function workoutFamily(type: string | undefined | null): WorkoutFamily {
  if (!type) return 'other';
  const t = type.toLowerCase();
  // Hike must be checked before run/walk so 'TrailHike' / 'Hiking' don't
  // accidentally match the walk/run rules. Use the 'hik' stem since 'hike'
  // is not a substring of 'hiking'.
  if (/hik/.test(t)) return 'hike';
  // 'run' / 'jog' as a substring so 'VirtualRun', 'TrailRun', 'Running',
  // 'Outdoor Run' all collapse to the run family.
  if (/(run|jog)/.test(t)) return 'run';
  if (/(ride|bike|cycl)/.test(t)) return 'bike';
  if (/walk/.test(t)) return 'walk';
  if (/(strength|lift|weight|crossfit|workout$)/.test(t)) return 'strength';
  return 'other';
}

export type WorkoutLike = {
  startedAt: string; // ISO timestamp
  durationSeconds?: number | null;
  workoutType: string;
  source?: string; // not used by matcher, surfaced for caller convenience
  id?: string;
};

export type MatchOptions = {
  /** ± seconds tolerance on start time. Default 120 (2 minutes). */
  toleranceSeconds?: number;
  /** ± fraction tolerance on duration when both have one. Default 0.10 (10%). */
  durationPctTolerance?: number;
};

/**
 * Decide whether two workout records describe the same training session.
 * Rules:
 *   - workoutFamily must match (Run ↔ Outdoor Run ↔ Trail Run all = 'run');
 *   - `startedAt` within ±toleranceSeconds (default 120 s);
 *   - if BOTH have a `durationSeconds`, they must be within ±durationPctTolerance
 *     of the longer value (default 10%);
 *   - if either is missing duration, time + family alone are enough.
 */
export function isSameSession(
  a: WorkoutLike,
  b: WorkoutLike,
  opts: MatchOptions = {},
): boolean {
  const toleranceSeconds = opts.toleranceSeconds ?? 120;
  const durationPctTolerance = opts.durationPctTolerance ?? 0.1;

  if (workoutFamily(a.workoutType) !== workoutFamily(b.workoutType)) return false;
  if (workoutFamily(a.workoutType) === 'other') return false; // don't fold unknowns together

  const aMs = new Date(a.startedAt).getTime();
  const bMs = new Date(b.startedAt).getTime();
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return false;
  if (Math.abs(aMs - bMs) > toleranceSeconds * 1000) return false;

  if (a.durationSeconds != null && b.durationSeconds != null) {
    const longer = Math.max(a.durationSeconds, b.durationSeconds);
    const delta = Math.abs(a.durationSeconds - b.durationSeconds);
    if (longer > 0 && delta / longer > durationPctTolerance) return false;
  }

  return true;
}

/**
 * Search a list of existing workouts for the first one that matches the
 * candidate. Returns null when no match is found. Callers (the Apple push
 * route and the Strava sync route) use this to decide whether to insert a
 * new row or link the new row as `superseded_by` the existing match.
 */
export function findExistingMatch<T extends WorkoutLike>(
  candidate: WorkoutLike,
  existing: T[],
  opts?: MatchOptions,
): T | null {
  for (const e of existing) {
    if (isSameSession(candidate, e, opts)) return e;
  }
  return null;
}
