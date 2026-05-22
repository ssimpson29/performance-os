import type { SupabaseClient } from '@supabase/supabase-js';

import { matchPlannedSessionsToWorkouts } from './plan-matching';
import type {
  ActualWorkoutForMatching,
  PlannedSessionForMatching,
  WorkoutSource,
} from './types';

/**
 * Reconcile `plan_workout_matches` for a user over a date range.
 *
 * The Apple Health / manual workout-import path already calls the planned-
 * session matcher inline (see importActualWorkouts in workout-ingestion.ts).
 * The Strava sync path inserts workouts via processStravaActivity, which
 * does NOT touch plan_workout_matches — so a Strava-only workout would
 * never land in a planned session's "completed" bucket. This helper closes
 * that gap by re-running the matcher against the canonical workouts in a
 * window after a Strava sync (or webhook event).
 *
 * It is idempotent: existing matches for the planned_sessions in range are
 * dropped first, then the matcher's output is inserted. Callers can safely
 * invoke it on every sync — the cardinality of planned_sessions in a few-
 * day window is small (handful to dozens).
 *
 * Returns the count of matches written, so callers can summarize or skip
 * logging when there's nothing to do.
 */
export async function applyPlanMatchingForUserDateRange(
  supabase: SupabaseClient,
  args: { userId: string; fromDate: string; toDate: string },
): Promise<{ matchedCount: number; plannedSessionCount: number; workoutCount: number }> {
  const { userId, fromDate, toDate } = args;

  // 1. Planned sessions in the window for this athlete.
  const { data: plannedSessions, error: psErr } = await supabase
    .from('planned_sessions')
    .select('id, session_date, title, discipline, duration_minutes, objective, notes, metadata')
    .eq('user_id', userId)
    .gte('session_date', fromDate)
    .lte('session_date', toDate)
    .order('session_date', { ascending: true });

  if (psErr) {
    throw new Error(`plan-matching-runner: failed to load planned_sessions: ${psErr.message}`);
  }
  if (!plannedSessions || plannedSessions.length === 0) {
    return { matchedCount: 0, plannedSessionCount: 0, workoutCount: 0 };
  }

  // 2. Canonical workouts in the window. `superseded_by IS NULL` so the
  // matcher only sees the canonical row when both Apple and Strava recorded
  // the same session — otherwise we'd count the workout twice.
  const { data: workouts, error: wErr } = await supabase
    .from('workouts')
    .select('id, external_id, source, workout_type, started_at, local_date, duration_seconds, distance_meters, metadata')
    .eq('user_id', userId)
    .is('superseded_by', null)
    .gte('local_date', fromDate)
    .lte('local_date', toDate);

  if (wErr) {
    throw new Error(`plan-matching-runner: failed to load workouts: ${wErr.message}`);
  }

  // 3. Adapt DB rows to matcher input shapes.
  const matcherPlanned: PlannedSessionForMatching[] = plannedSessions.map((session) => {
    const s = session as Record<string, unknown>;
    return {
      id: String(s.id),
      sessionDate: String(s.session_date),
      title: String(s.title),
      discipline: String(s.discipline ?? ''),
      durationMinutes: typeof s.duration_minutes === 'number' ? s.duration_minutes : null,
      objective: typeof s.objective === 'string' ? s.objective : null,
      notes: typeof s.notes === 'string' ? s.notes : null,
      metadata:
        typeof s.metadata === 'object' && s.metadata != null
          ? (s.metadata as Record<string, unknown>)
          : null,
    };
  });

  const matcherActual: ActualWorkoutForMatching[] = (workouts ?? []).map((workout) => {
    const w = workout as Record<string, unknown>;
    return {
      id: String(w.id),
      externalId: String(w.external_id ?? ''),
      source: String(w.source) as WorkoutSource,
      workoutType: String(w.workout_type ?? ''),
      startedAt: String(w.started_at ?? ''),
      localDate: String(w.local_date ?? ''),
      durationSeconds: typeof w.duration_seconds === 'number' ? w.duration_seconds : null,
      distanceMeters: typeof w.distance_meters === 'number' ? w.distance_meters : null,
      metadata:
        typeof w.metadata === 'object' && w.metadata != null
          ? (w.metadata as Record<string, unknown>)
          : null,
    };
  });

  // 4. Run the matcher.
  const summary = matchPlannedSessionsToWorkouts(matcherPlanned, matcherActual);

  // 5. Replace existing matches for these planned_sessions. We don't want a
  // re-match to leave stale rows behind (e.g. a Strava activity that was
  // marked 'completed' but later got superseded by an Apple workout).
  const plannedIds = matcherPlanned.map((p) => p.id);
  const { error: deleteErr } = await supabase
    .from('plan_workout_matches')
    .delete()
    .in('planned_session_id', plannedIds);
  if (deleteErr) {
    throw new Error(`plan-matching-runner: failed to clear stale matches: ${deleteErr.message}`);
  }

  // 6. Insert non-missed matches (the matcher returns 'missed' rows in the
  // summary for visibility, but plan_workout_matches only stores hits).
  const persistedMatches = summary.matches
    .filter((m) => m.workoutId && m.status !== 'missed')
    .map((m) => ({
      user_id: userId,
      planned_session_id: m.plannedSessionId,
      workout_id: m.workoutId,
      status: m.status,
      confidence: m.confidence,
      reasoning: m.reasoning,
    }));

  if (persistedMatches.length > 0) {
    const { error: insertErr } = await supabase
      .from('plan_workout_matches')
      .insert(persistedMatches);
    if (insertErr) {
      throw new Error(`plan-matching-runner: failed to insert matches: ${insertErr.message}`);
    }
  }

  return {
    matchedCount: persistedMatches.length,
    plannedSessionCount: plannedSessions.length,
    workoutCount: matcherActual.length,
  };
}
