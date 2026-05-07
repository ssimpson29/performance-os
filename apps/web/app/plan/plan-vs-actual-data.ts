import { hasSupabaseServiceRoleEnv } from '@/lib/env';
import { planVsActualPlannedSessions, planVsActualWorkouts } from '@/lib/sample-data';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { matchPlannedSessionsToWorkouts, normalizeActualWorkoutPayload } from '@/lib/training-plan/workout-ingestion';
import type { PlanWorkoutMatch } from '@/lib/training-plan/types';

export type PlanVsActualSessionPreview = {
  plannedSessionId: string;
  sessionDate: string;
  title: string;
  plannedDurationMinutes?: number | null;
  status: 'completed' | 'partial' | 'substituted' | 'missed';
  reasoning: string;
  actualWorkoutType?: string;
  actualDurationMinutes?: number;
};

export type OffPlanWorkoutPreview = {
  externalId: string;
  workoutType: string;
  localDate: string;
  durationMinutes?: number;
};

export type PlanVsActualPreview = {
  dataSource: 'sample' | 'live' | 'unconfigured';
  planName: string | null;
  sessions: PlanVsActualSessionPreview[];
  offPlanWorkouts: OffPlanWorkoutPreview[];
  summary: {
    completed: number;
    partial: number;
    substituted: number;
    missed: number;
    offPlan: number;
  };
};

type PersistedPlanSessionRecord = {
  id: string;
  sessionDate: string;
  title: string;
  durationMinutes?: number | null;
};

type PersistedWorkoutRecord = {
  id: string;
  externalId: string;
  workoutType: string;
  localDate: string;
  durationSeconds?: number | null;
};

function emptyPreview(dataSource: PlanVsActualPreview['dataSource'], planName: string | null = null): PlanVsActualPreview {
  return {
    dataSource,
    planName,
    sessions: [],
    offPlanWorkouts: [],
    summary: {
      completed: 0,
      partial: 0,
      substituted: 0,
      missed: 0,
      offPlan: 0,
    },
  };
}

export function buildPlanVsActualPreviewFromRecords(input: {
  planName: string | null;
  plannedSessions: PersistedPlanSessionRecord[];
  matches: PlanWorkoutMatch[];
  workouts: PersistedWorkoutRecord[];
  dataSource?: PlanVsActualPreview['dataSource'];
}): PlanVsActualPreview {
  const workoutLookup = new Map(input.workouts.map((workout) => [workout.id, workout]));
  const matchedWorkoutIds = new Set(input.matches.flatMap((match) => (match.workoutId ? [match.workoutId] : [])));
  const matchLookup = new Map(input.matches.map((match) => [match.plannedSessionId, match]));

  const sessions = input.plannedSessions
    .map((plannedSession) => {
      const match = matchLookup.get(plannedSession.id);
      const workout = match?.workoutId ? workoutLookup.get(match.workoutId) : undefined;

      return {
        plannedSessionId: plannedSession.id,
        sessionDate: plannedSession.sessionDate,
        title: plannedSession.title,
        plannedDurationMinutes: plannedSession.durationMinutes,
        status: match?.status ?? 'missed',
        reasoning: match?.reasoning ?? 'No matched workout has been logged for this planned session yet.',
        actualWorkoutType: workout?.workoutType,
        actualDurationMinutes: workout?.durationSeconds ? Math.round(workout.durationSeconds / 60) : undefined,
      } satisfies PlanVsActualSessionPreview;
    })
    .sort((left, right) => left.sessionDate.localeCompare(right.sessionDate));

  const offPlanWorkouts = input.workouts
    .filter((workout) => !matchedWorkoutIds.has(workout.id))
    .map((workout) => ({
      externalId: workout.externalId,
      workoutType: workout.workoutType,
      localDate: workout.localDate,
      durationMinutes: workout.durationSeconds ? Math.round(workout.durationSeconds / 60) : undefined,
    }));

  return {
    dataSource: input.dataSource ?? 'live',
    planName: input.planName,
    sessions,
    offPlanWorkouts,
    summary: {
      completed: sessions.filter((session) => session.status === 'completed').length,
      partial: sessions.filter((session) => session.status === 'partial').length,
      substituted: sessions.filter((session) => session.status === 'substituted').length,
      missed: sessions.filter((session) => session.status === 'missed').length,
      offPlan: offPlanWorkouts.length,
    },
  };
}

export function buildPlanVsActualPreview(): PlanVsActualPreview {
  const normalized = normalizeActualWorkoutPayload({
    userId: 'preview-user',
    workouts: planVsActualWorkouts,
  });

  const matching = matchPlannedSessionsToWorkouts({
    plannedSessions: planVsActualPlannedSessions,
    actualWorkouts: normalized.workouts,
  });

  const workoutLookup = new Map(normalized.workouts.map((workout) => [workout.externalId, workout]));
  const plannedLookup = new Map(planVsActualPlannedSessions.map((session) => [session.id, session]));

  const samplePreview = buildPlanVsActualPreviewFromRecords({
    dataSource: 'sample',
    planName: 'Sample plan-vs-actual preview',
    plannedSessions: planVsActualPlannedSessions.map((session) => ({
      id: session.id,
      sessionDate: session.sessionDate,
      title: session.title,
      durationMinutes: session.durationMinutes,
    })),
    matches: [
      ...matching.matches.map((match) => ({
        plannedSessionId: match.plannedSessionId,
        workoutId: match.workoutExternalId,
        status: match.status,
        confidence: match.confidence,
        reasoning: match.reasoning,
      })),
      ...matching.missedSessions.map((match) => ({
        plannedSessionId: match.plannedSessionId,
        status: 'missed' as const,
        confidence: match.confidence,
        reasoning: match.reasoning,
      })),
    ],
    workouts: normalized.workouts.map((workout) => ({
      id: workout.externalId,
      externalId: workout.externalId,
      workoutType: workout.workoutType,
      localDate: workout.localDate,
      durationSeconds: workout.durationSeconds,
    })),
  });

  return samplePreview;
}

export async function loadPlanVsActualPreview(): Promise<PlanVsActualPreview> {
  if (!hasSupabaseServiceRoleEnv()) {
    return emptyPreview('unconfigured');
  }

  const supabase = createServerSupabaseClient();
  const { data: latestPlan, error: latestPlanError } = await supabase
    .from('training_plans')
    .select('id, name, user_id')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestPlanError || !latestPlan) {
    return emptyPreview('live');
  }

  const { data: plannedSessions, error: plannedSessionsError } = await supabase
    .from('planned_sessions')
    .select('id, session_date, title, duration_minutes')
    .eq('training_plan_id', latestPlan.id)
    .order('session_date', { ascending: true });

  if (plannedSessionsError || !plannedSessions || plannedSessions.length === 0) {
    return emptyPreview('live', latestPlan.name);
  }

  const orderedSessions = plannedSessions.map((session) => ({
    id: String(session.id),
    sessionDate: String(session.session_date),
    title: String(session.title),
    durationMinutes: typeof session.duration_minutes === 'number' ? session.duration_minutes : null,
  }));

  const sessionIds = orderedSessions.map((session) => session.id);
  const { data: matchesData, error: matchesError } = await supabase
    .from('plan_workout_matches')
    .select('planned_session_id, workout_id, status, confidence, reasoning')
    .in('planned_session_id', sessionIds);

  if (matchesError) {
    return emptyPreview('live', latestPlan.name);
  }

  const minDate = orderedSessions[0]?.sessionDate;
  const maxDate = orderedSessions[orderedSessions.length - 1]?.sessionDate;

  const { data: workoutsData, error: workoutsError } = await supabase
    .from('workouts')
    .select('id, external_id, workout_type, local_date, duration_seconds')
    .eq('user_id', latestPlan.user_id)
    .gte('local_date', minDate)
    .lte('local_date', maxDate)
    .order('local_date', { ascending: true });

  if (workoutsError) {
    return emptyPreview('live', latestPlan.name);
  }

  return buildPlanVsActualPreviewFromRecords({
    dataSource: 'live',
    planName: latestPlan.name,
    plannedSessions: orderedSessions,
    matches: (matchesData ?? []).map((match) => ({
      plannedSessionId: String(match.planned_session_id),
      workoutId: match.workout_id ? String(match.workout_id) : undefined,
      status: match.status as PlanWorkoutMatch['status'],
      confidence: typeof match.confidence === 'number' ? match.confidence : 0,
      reasoning: String(match.reasoning ?? ''),
    })),
    workouts: (workoutsData ?? []).map((workout) => ({
      id: String(workout.id),
      externalId: String(workout.external_id),
      workoutType: String(workout.workout_type),
      localDate: String(workout.local_date),
      durationSeconds: typeof workout.duration_seconds === 'number' ? workout.duration_seconds : null,
    })),
  });
}
