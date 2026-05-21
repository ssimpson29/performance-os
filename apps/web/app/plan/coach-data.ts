import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AdaptiveCoachInput,
  CompletedWorkout,
  PhaseBlock,
  RaceContext,
  RecoverySample,
  WeeklyStructureSession,
} from '@/lib/training-plan/types';

const DEFAULT_LOOKBACK_DAYS = 14;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayFromIsoDate(iso: string): string {
  // Treat the date as UTC midnight so server timezone doesn't shift the day-of-week.
  const parts = iso.slice(0, 10).split('-').map((p) => Number.parseInt(p, 10));
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return DAY_NAMES[d.getUTCDay()];
}

function isoDateAddDays(isoToday: string, deltaDays: number): string {
  const parts = isoToday.slice(0, 10).split('-').map((p) => Number.parseInt(p, 10));
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

type WorkoutRow = {
  local_date: string;
  workout_type: string;
  duration_seconds: number | null;
  perceived_exertion: number | null;
};

/**
 * Load completed workouts for the authenticated athlete in the recent
 * window, normalized to AdaptiveCoach's CompletedWorkout shape.
 *
 * loadScore is derived: minutes + intensity * 20. Rough proxy; the engine
 * is robust to magnitude because it scores via overload thresholds, not
 * absolute load values.
 */
export async function loadCompletedWorkouts(
  supabase: SupabaseClient,
  userId: string,
  options: { today?: string; lookbackDays?: number } = {},
): Promise<CompletedWorkout[]> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const lookback = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const since = isoDateAddDays(today, -lookback);

  const { data, error } = await supabase
    .from('workouts')
    .select('local_date, workout_type, duration_seconds, perceived_exertion')
    .eq('user_id', userId)
    .gte('local_date', since)
    .lte('local_date', today)
    .order('local_date', { ascending: true });

  if (error) {
    throw new Error(`Failed to load workouts for coach context: ${error.message}`);
  }

  return (data as WorkoutRow[] | null ?? []).map((row) => {
    const durationMinutes = row.duration_seconds ? Math.round(row.duration_seconds / 60) : 0;
    const intensityScore = row.perceived_exertion ?? 5;
    return {
      day: dayFromIsoDate(row.local_date),
      durationMinutes,
      intensityScore,
      loadScore: durationMinutes + intensityScore * 20,
      sessionType: row.workout_type,
    };
  });
}

type RecoveryRow = {
  day: string;
  readiness_score: number | null;
};

/**
 * Load recent recovery samples (readiness scores) for trend detection.
 * Rows with null readiness_score are filtered out so the trend detector
 * doesn't see fake zeros.
 */
export async function loadRecoveryHistory(
  supabase: SupabaseClient,
  userId: string,
  options: { today?: string; lookbackDays?: number } = {},
): Promise<RecoverySample[]> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const lookback = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const since = isoDateAddDays(today, -lookback);

  const { data, error } = await supabase
    .from('recovery_daily')
    .select('day, readiness_score')
    .eq('user_id', userId)
    .gte('day', since)
    .lte('day', today)
    .order('day', { ascending: true });

  if (error) {
    throw new Error(`Failed to load recovery history for coach context: ${error.message}`);
  }

  return (data as RecoveryRow[] | null ?? [])
    .filter((row) => row.readiness_score != null)
    .map((row) => ({ date: row.day, score: row.readiness_score as number }));
}

export type ActiveTrainingPlanContext = {
  planId: string;
  planStartDate: string | null;
  raceDate: string | null;
  goal: string | null;
  weeklyStructure: WeeklyStructureSession[];
  phaseBlocks: PhaseBlock[];
  raceContext?: RaceContext;
};

type TrainingPlanRow = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  goal: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Load the athlete's most recent training plan with its persisted race
 * context. Returns null when the athlete has no plan on record.
 */
export async function loadActiveTrainingPlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActiveTrainingPlanContext | null> {
  const { data, error } = await supabase
    .from('training_plans')
    .select('id, start_date, end_date, goal, metadata, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to load training plan for coach context: ${error.message}`);
  }

  const rows = (data as TrainingPlanRow[] | null) ?? [];
  if (rows.length === 0) return null;

  const row = rows[0];
  const metadata = row.metadata ?? {};
  return {
    planId: row.id,
    planStartDate: row.start_date,
    raceDate: row.end_date,
    goal: row.goal,
    weeklyStructure: (metadata.weeklyStructure as WeeklyStructureSession[] | undefined) ?? [],
    phaseBlocks: (metadata.phaseBlocks as PhaseBlock[] | undefined) ?? [],
    raceContext: metadata.raceContext as RaceContext | undefined,
  };
}

type DailySummaryLongevityRow = {
  summary: Record<string, unknown> | null;
};

/**
 * Read just the cross-write longevityContext signal for the athlete + today.
 * Returns null when nothing is set. Lightweight read used by the Training
 * Coach data loader to factor longevity priority into adaptive decisions.
 */
export async function loadLongevityContextForAthlete(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<AdaptiveCoachInput['longevityContext'] | null> {
  const { data, error } = await supabase
    .from('daily_summaries')
    .select('summary')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);
  if (error) {
    throw new Error(`Failed to load longevityContext: ${error.message}`);
  }
  const summary = ((data as DailySummaryLongevityRow[] | null) ?? [])[0]?.summary ?? {};
  const ctx = (summary as Record<string, unknown>).longevityContext;
  if (!ctx || typeof ctx !== 'object') return null;
  const obj = ctx as Record<string, unknown>;
  if (
    obj.recoveryPriority !== 'low' &&
    obj.recoveryPriority !== 'normal' &&
    obj.recoveryPriority !== 'elevated'
  ) {
    return null;
  }
  return {
    recoveryPriority: obj.recoveryPriority,
    notes: typeof obj.notes === 'string' ? obj.notes : undefined,
    evaluatedAt: typeof obj.evaluatedAt === 'string' ? obj.evaluatedAt : undefined,
  };
}

export type LoadAdaptiveCoachContextOptions = {
  today?: string;
  lookbackDays?: number;
  /** Override the plan source — used by the training-plan import route to feed the just-parsed (not-yet-persisted) plan. */
  planOverride?: ActiveTrainingPlanContext;
};

/**
 * Assemble a full AdaptiveCoachInput for the athlete by loading their
 * active plan, recent workouts, and recent recovery samples. Throws if
 * the athlete has no active plan AND no planOverride is supplied.
 */
export async function loadAdaptiveCoachContext(
  supabase: SupabaseClient,
  userId: string,
  options: LoadAdaptiveCoachContextOptions = {},
): Promise<AdaptiveCoachInput> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  const plan =
    options.planOverride ??
    (await loadActiveTrainingPlan(supabase, userId));

  if (!plan) {
    throw new Error('No active training plan found for athlete; cannot assemble coach context.');
  }

  const [completedWorkouts, recoveryHistory, longevityContext] = await Promise.all([
    loadCompletedWorkouts(supabase, userId, { today, lookbackDays: options.lookbackDays }),
    loadRecoveryHistory(supabase, userId, { today, lookbackDays: options.lookbackDays }),
    loadLongevityContextForAthlete(supabase, userId, today),
  ]);

  const currentDay = dayFromIsoDate(today);
  const recoveryScore = recoveryHistory.length
    ? recoveryHistory[recoveryHistory.length - 1].score
    : undefined;

  return {
    weeklyStructure: plan.weeklyStructure,
    completedWorkouts,
    currentDay,
    recoveryScore,
    today,
    raceDate: plan.raceDate ?? undefined,
    planStartDate: plan.planStartDate ?? undefined,
    phaseBlocks: plan.phaseBlocks,
    recoveryHistory,
    goal: plan.goal ?? undefined,
    raceContext: plan.raceContext,
    longevityContext: longevityContext ?? undefined,
  };
}
