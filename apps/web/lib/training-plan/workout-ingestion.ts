import type { SupabaseClient } from '@supabase/supabase-js';

import {
  linkAppleRowsToStravaMatches,
  type AppleRowForMerge,
  type AppleStravaMergeResult,
} from '@/lib/workouts/apple-strava-merge';

import { matchPlannedSessionsToWorkouts as computeMatchSummary } from './plan-matching';
import type {
  ActualWorkoutForMatching,
  ActualWorkoutInput,
  PlannedSessionForMatching,
  WorkoutSource,
} from './types';

export type { PlannedSessionForMatching } from './types';

type ActualWorkoutPayloadInput = ActualWorkoutInput & {
  durationMinutes?: number;
};

export type NormalizedActualWorkoutRow = {
  userId: string;
  source: WorkoutSource;
  externalId: string;
  workoutType: string;
  startedAt: string;
  endedAt?: string;
  localDate: string;
  durationSeconds?: number;
  distanceMeters?: number;
  energyKcal?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgPowerWatts?: number;
  avgCadence?: number;
  perceivedExertion?: number;
  metadata: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
};

export type NormalizeActualWorkoutPayloadInput = {
  userId: string;
  workouts: ActualWorkoutPayloadInput[];
};

export type WorkoutMatchResult = {
  plannedSessionId: string;
  workoutExternalId: string;
  status: 'completed' | 'partial' | 'substituted';
  confidence: number;
  reasoning: string;
};

export type MissedSessionResult = {
  plannedSessionId: string;
  status: 'missed';
  confidence: number;
  reasoning: string;
};

export type WorkoutMatchingSummary = {
  matches: WorkoutMatchResult[];
  missedSessions: MissedSessionResult[];
  unmatchedWorkoutExternalIds: string[];
  summary: {
    completed: number;
    partial: number;
    substituted: number;
    missed: number;
    matched: number;
    unmatchedActual: number;
  };
};

function normalizeIso(value: string): string {
  return new Date(value).toISOString();
}

function deriveExternalId(workout: ActualWorkoutPayloadInput): string {
  if (workout.externalId?.trim()) {
    return workout.externalId.trim();
  }

  return `${workout.source}:${normalizeIso(workout.startedAt)}:${workout.workoutType.trim()}`;
}

function deriveLocalDate(workout: ActualWorkoutPayloadInput): string {
  if (workout.localDate?.trim()) {
    return workout.localDate.trim();
  }

  return normalizeIso(workout.startedAt).slice(0, 10);
}

function deriveDurationSeconds(workout: ActualWorkoutPayloadInput): number | undefined {
  if (workout.durationSeconds != null) {
    return workout.durationSeconds;
  }

  if (workout.durationMinutes != null) {
    return Math.round(workout.durationMinutes * 60);
  }

  if (!workout.endedAt) {
    return undefined;
  }

  const startedAt = new Date(workout.startedAt).getTime();
  const endedAt = new Date(workout.endedAt).getTime();

  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt <= startedAt) {
    return undefined;
  }

  return Math.round((endedAt - startedAt) / 1000);
}

export function normalizeActualWorkout(workout: ActualWorkoutPayloadInput, userId = 'unknown'): NormalizedActualWorkoutRow {
  return {
    userId,
    source: workout.source,
    externalId: deriveExternalId(workout),
    workoutType: workout.workoutType.trim(),
    startedAt: normalizeIso(workout.startedAt),
    endedAt: workout.endedAt ? normalizeIso(workout.endedAt) : undefined,
    localDate: deriveLocalDate(workout),
    durationSeconds: deriveDurationSeconds(workout),
    distanceMeters: workout.distanceMeters,
    energyKcal: workout.energyKcal,
    avgHeartRate: workout.avgHeartRate,
    maxHeartRate: workout.maxHeartRate,
    avgPowerWatts: workout.avgPowerWatts,
    avgCadence: workout.avgCadence,
    perceivedExertion: workout.perceivedExertion,
    metadata: workout.metadata ?? {},
    rawPayload: workout as Record<string, unknown>,
  };
}

export function normalizeActualWorkouts(workouts: ActualWorkoutInput[]): NormalizedActualWorkoutRow[] {
  return workouts.map((workout) => normalizeActualWorkout(workout));
}

export function normalizeActualWorkoutPayload(input: NormalizeActualWorkoutPayloadInput) {
  return {
    userId: input.userId,
    workouts: input.workouts.map((workout) => normalizeActualWorkout(workout, input.userId)),
  };
}

function toActualWorkoutForMatching(workout: NormalizedActualWorkoutRow): ActualWorkoutForMatching {
  return {
    id: workout.externalId,
    externalId: workout.externalId,
    source: workout.source,
    workoutType: workout.workoutType,
    startedAt: workout.startedAt,
    localDate: workout.localDate,
    durationSeconds: workout.durationSeconds,
    distanceMeters: workout.distanceMeters,
    metadata: workout.metadata,
  };
}

export function matchPlannedSessionsToWorkouts(input: {
  plannedSessions: PlannedSessionForMatching[];
  actualWorkouts: NormalizedActualWorkoutRow[];
}): WorkoutMatchingSummary {
  const summary = computeMatchSummary(
    input.plannedSessions,
    input.actualWorkouts.map(toActualWorkoutForMatching),
  );

  const matches: WorkoutMatchResult[] = summary.matches
    .filter(
      (match): match is typeof match & { workoutId: string; status: WorkoutMatchResult['status'] } =>
        match.status !== 'missed' && Boolean(match.workoutId),
    )
    .map((match) => ({
      plannedSessionId: match.plannedSessionId,
      workoutExternalId: match.workoutId,
      status: match.status,
      confidence: match.confidence,
      reasoning: match.reasoning,
    }));

  const missedSessions = summary.matches
    .filter((match) => match.status === 'missed')
    .map((match) => ({
      plannedSessionId: match.plannedSessionId,
      status: 'missed' as const,
      confidence: match.confidence,
      reasoning: match.reasoning,
    }));

  return {
    matches,
    missedSessions,
    unmatchedWorkoutExternalIds: summary.unmatchedWorkoutIds,
    summary: {
      completed: matches.filter((match) => match.status === 'completed').length,
      partial: matches.filter((match) => match.status === 'partial').length,
      substituted: matches.filter((match) => match.status === 'substituted').length,
      missed: missedSessions.length,
      matched: matches.length,
      unmatchedActual: summary.unmatchedWorkoutIds.length,
    },
  };
}

function getDateRange(workouts: NormalizedActualWorkoutRow[]) {
  const dates = workouts.map((workout) => workout.localDate).sort();
  const earliest = new Date(`${dates[0]}T00:00:00Z`);
  const latest = new Date(`${dates[dates.length - 1]}T00:00:00Z`);

  earliest.setUTCDate(earliest.getUTCDate() - 1);
  latest.setUTCDate(latest.getUTCDate() + 1);

  return {
    start: earliest.toISOString().slice(0, 10),
    end: latest.toISOString().slice(0, 10),
  };
}

function toWorkoutRow(workout: NormalizedActualWorkoutRow) {
  return {
    user_id: workout.userId,
    source: workout.source,
    external_id: workout.externalId,
    workout_type: workout.workoutType,
    started_at: workout.startedAt,
    ended_at: workout.endedAt ?? null,
    local_date: workout.localDate,
    duration_seconds: workout.durationSeconds ?? null,
    distance_meters: workout.distanceMeters ?? null,
    energy_kcal: workout.energyKcal ?? null,
    avg_heart_rate: workout.avgHeartRate ?? null,
    max_heart_rate: workout.maxHeartRate ?? null,
    avg_power_watts: workout.avgPowerWatts ?? null,
    avg_cadence: workout.avgCadence ?? null,
    perceived_exertion: workout.perceivedExertion ?? null,
    metadata: workout.metadata,
    raw_payload: workout.rawPayload,
  };
}

function toPlannedSession(session: Record<string, unknown>): PlannedSessionForMatching {
  return {
    id: String(session.id),
    sessionDate: String(session.session_date),
    title: String(session.title),
    discipline: String(session.discipline),
    durationMinutes: typeof session.duration_minutes === 'number' ? session.duration_minutes : null,
    objective: typeof session.objective === 'string' ? session.objective : null,
    notes: typeof session.notes === 'string' ? session.notes : null,
    metadata: typeof session.metadata === 'object' && session.metadata != null ? (session.metadata as Record<string, unknown>) : null,
  };
}

export async function importActualWorkouts(
  supabase: SupabaseClient,
  input: NormalizeActualWorkoutPayloadInput,
) {
  const normalized = normalizeActualWorkoutPayload(input);
  if (normalized.workouts.length === 0) {
    return {
      importedWorkouts: 0,
      matching: {
        matches: [],
        missedSessions: [],
        unmatchedWorkoutExternalIds: [],
        summary: {
          completed: 0,
          partial: 0,
          substituted: 0,
          missed: 0,
          matched: 0,
          unmatchedActual: 0,
        },
      },
      appleStravaMerge: null as AppleStravaMergeResult | null,
    };
  }

  const workoutRows = normalized.workouts.map(toWorkoutRow);
  const { data: persistedWorkouts, error: workoutsError } = await supabase
    .from('workouts')
    .upsert(workoutRows, { onConflict: 'user_id,source,external_id' })
    .select('id, external_id, source, workout_type, started_at, duration_seconds, description');

  if (workoutsError || !persistedWorkouts) {
    throw new Error(workoutsError?.message ?? 'Failed to persist workouts');
  }

  // Phase 3 of the Strava integration: if any of the newly-upserted rows are
  // Apple-sourced, run the duplicate matcher against pre-existing Strava
  // rows so a Strava row that arrived first gets linked to the Apple row
  // (which is canonical for metrics) and its description is forwarded onto
  // the Apple row. The Strava-side merge already handles the opposite
  // ordering. Failure here is non-fatal to the workout import — we log and
  // continue so a transient merge issue can't block the Apple sync.
  const persistedAppleRows: AppleRowForMerge[] = (persistedWorkouts as Array<Record<string, unknown>>)
    .filter((row) => row.source === 'apple_health' || row.source === 'apple_watch')
    .map((row) => ({
      id: String(row.id),
      source: row.source as 'apple_health' | 'apple_watch',
      external_id: String(row.external_id),
      workout_type: String(row.workout_type),
      started_at: String(row.started_at),
      duration_seconds:
        typeof row.duration_seconds === 'number' ? row.duration_seconds : null,
      description: typeof row.description === 'string' ? row.description : null,
    }));
  let appleStravaMerge: AppleStravaMergeResult | null = null;
  if (persistedAppleRows.length > 0) {
    try {
      appleStravaMerge = await linkAppleRowsToStravaMatches(supabase, {
        userId: input.userId,
        appleRows: persistedAppleRows,
      });
    } catch (err) {
      console.error('apple-strava-merge skipped:', err);
    }
  }

  const dateRange = getDateRange(normalized.workouts);
  const { data: plannedSessions, error: plannedSessionsError } = await supabase
    .from('planned_sessions')
    .select('id, session_date, title, discipline, duration_minutes, objective, notes, metadata')
    .eq('user_id', input.userId)
    .gte('session_date', dateRange.start)
    .lte('session_date', dateRange.end)
    .order('session_date', { ascending: true });

  if (plannedSessionsError || !plannedSessions) {
    throw new Error(plannedSessionsError?.message ?? 'Failed to load planned sessions for matching');
  }

  const matching = matchPlannedSessionsToWorkouts({
    plannedSessions: plannedSessions.map((session) => toPlannedSession(session as Record<string, unknown>)),
    actualWorkouts: normalized.workouts,
  });

  if (plannedSessions.length > 0) {
    const { error: deletePlannedMatchesError } = await supabase
      .from('plan_workout_matches')
      .delete()
      .in('planned_session_id', plannedSessions.map((session) => String((session as Record<string, unknown>).id)));

    if (deletePlannedMatchesError) {
      throw new Error(deletePlannedMatchesError.message);
    }
  }

  const workoutIdLookup = new Map(
    persistedWorkouts.map((workout) => [String((workout as Record<string, unknown>).external_id), String((workout as Record<string, unknown>).id)]),
  );
  const persistedMatches = matching.matches.map((match) => ({
    user_id: input.userId,
    planned_session_id: match.plannedSessionId,
    workout_id: workoutIdLookup.get(match.workoutExternalId),
    status: match.status,
    confidence: match.confidence,
    reasoning: match.reasoning,
  })).filter((match) => match.workout_id);

  if (persistedMatches.length > 0) {
    const { error: matchesError } = await supabase.from('plan_workout_matches').insert(persistedMatches);
    if (matchesError) {
      throw new Error(matchesError.message);
    }
  }

  return {
    importedWorkouts: normalized.workouts.length,
    matching,
    appleStravaMerge,
  };
}
