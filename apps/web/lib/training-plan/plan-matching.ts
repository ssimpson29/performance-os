import type {
  ActualWorkoutForMatching,
  MatchStatus,
  PlannedSessionForMatching,
  PlanWorkoutMatch,
  PlanWorkoutMatchSummary,
} from './types';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function classifySession(text: string): string {
  const normalized = normalizeText(text);

  if (/(interval|tempo|threshold|speed|track|quality)/.test(normalized)) {
    return 'quality';
  }

  if (/(long)/.test(normalized)) {
    return 'long';
  }

  if (/(recovery|easy|shakeout|rest)/.test(normalized)) {
    return 'recovery';
  }

  // Strava reports 'WeightTraining' (no space) for gym sessions; Apple
  // Health reports 'Strength Training'. Match both vocabularies so a Friday
  // strength workout from either source links to the planned strength
  // session.
  if (/(strength|lift|mobility|gym|weight ?training|weights)/.test(normalized)) {
    return 'strength';
  }

  if (/(ride|bike|cycl)/.test(normalized)) {
    return 'bike';
  }

  // Hike BEFORE run so "Trail Hike" lands as hike, not run.
  if (/(hike|hiking)/.test(normalized)) {
    return 'hike';
  }

  // Run family — extended for ultra-training vocabulary. Plans frequently
  // name run sessions "Trail Vert Session", "Hill Repeats", "Vert Run",
  // "Mountain Day" etc. without the literal word "run". Strava's
  // sport_type for those activities is still 'Run' or 'TrailRun', so the
  // matcher needs to bridge the planned vocabulary to the actual category.
  // Order matters: hike was checked first so "Trail Hike" doesn't collide.
  if (/(run|jog|aerobic|endurance|trail|vert|hill|climb|mountain)/.test(normalized)) {
    return 'run';
  }

  return normalized || 'other';
}

function dayDifference(firstDate: string, secondDate: string): number {
  const first = new Date(`${firstDate}T00:00:00Z`).getTime();
  const second = new Date(`${secondDate}T00:00:00Z`).getTime();
  return Math.round(Math.abs(first - second) / 86400000);
}

function durationMinutes(durationSeconds?: number | null): number | undefined {
  if (durationSeconds == null) {
    return undefined;
  }

  return durationSeconds / 60;
}

function getDurationScore(plannedMinutes?: number | null, actualSeconds?: number | null): number {
  if (plannedMinutes == null || actualSeconds == null) {
    return 0;
  }

  const actualMinutes = durationMinutes(actualSeconds) ?? 0;
  if (plannedMinutes <= 0 || actualMinutes <= 0) {
    return 0;
  }

  const ratio = actualMinutes / plannedMinutes;
  if (ratio >= 0.75 && ratio <= 1.35) {
    return 20;
  }
  if (ratio >= 0.4 && ratio <= 1.6) {
    return 10;
  }
  return 0;
}

function buildReasoning(parts: string[]): string {
  return parts.filter(Boolean).join('; ');
}

function determineStatus(
  planned: PlannedSessionForMatching,
  workout: ActualWorkoutForMatching,
  plannedCategory: string,
  workoutCategory: string,
): MatchStatus {
  const plannedMinutes = planned.durationMinutes ?? undefined;
  const actualMinutes = durationMinutes(workout.durationSeconds);
  const ratio = plannedMinutes && actualMinutes ? actualMinutes / plannedMinutes : undefined;

  if (plannedCategory === workoutCategory || (plannedCategory === 'long' && workoutCategory === 'run')) {
    if (ratio == null || ratio >= 0.75) {
      return 'completed';
    }
    return 'partial';
  }

  if (plannedCategory === 'quality' && workoutCategory === 'run') {
    return ratio != null && ratio >= 0.4 ? 'partial' : 'substituted';
  }

  if (plannedCategory === 'recovery' && (workoutCategory === 'hike' || workoutCategory === 'run')) {
    return 'substituted';
  }

  return 'substituted';
}

function scoreCandidate(
  planned: PlannedSessionForMatching,
  workout: ActualWorkoutForMatching,
): { confidence: number; reasoning: string; status: MatchStatus } | null {
  const diffDays = dayDifference(planned.sessionDate, workout.localDate);
  if (diffDays > 1) {
    return null;
  }

  const plannedCategory = classifySession(`${planned.title} ${planned.discipline} ${planned.objective ?? ''} ${planned.notes ?? ''}`);
  const workoutCategory = classifySession(workout.workoutType);

  let score = diffDays === 0 ? 50 : 20;
  const reasons = [diffDays === 0 ? 'same-day date match' : 'within one day date window'];

  if (plannedCategory === workoutCategory) {
    score += 30;
    reasons.push(`same discipline category (${plannedCategory})`);
  } else if (
    (plannedCategory === 'long' && workoutCategory === 'run') ||
    (plannedCategory === 'quality' && workoutCategory === 'run') ||
    (plannedCategory === 'recovery' && (workoutCategory === 'run' || workoutCategory === 'hike'))
  ) {
    score += 18;
    reasons.push(`compatible substitution (${plannedCategory} vs ${workoutCategory})`);
  } else if (plannedCategory === 'run' && workoutCategory === 'quality') {
    score += 12;
    reasons.push('run-compatible workout type');
  }

  const durationScore = getDurationScore(planned.durationMinutes, workout.durationSeconds);
  score += durationScore;
  if (durationScore > 0) {
    reasons.push(durationScore === 20 ? 'duration closely matched' : 'duration partially matched');
  }

  const status = determineStatus(planned, workout, plannedCategory, workoutCategory);

  if (status === 'substituted' && score < 60) {
    return null;
  }

  if (score < 50) {
    return null;
  }

  return {
    confidence: Math.min(score, 99),
    reasoning: buildReasoning(reasons),
    status,
  };
}

export function matchPlannedSessionsToWorkouts(
  plannedSessions: PlannedSessionForMatching[],
  workouts: ActualWorkoutForMatching[],
): PlanWorkoutMatchSummary {
  const remainingWorkoutIds = new Set(workouts.map((workout) => workout.id));
  const matches: PlanWorkoutMatch[] = [];

  const plannedByDate = [...plannedSessions].sort((left, right) => left.sessionDate.localeCompare(right.sessionDate));

  for (const planned of plannedByDate) {
    let bestWorkout: ActualWorkoutForMatching | undefined;
    let bestCandidate: { confidence: number; reasoning: string; status: MatchStatus } | undefined;

    for (const workout of workouts) {
      if (!remainingWorkoutIds.has(workout.id)) {
        continue;
      }

      const candidate = scoreCandidate(planned, workout);
      if (!candidate) {
        continue;
      }

      if (!bestCandidate || candidate.confidence > bestCandidate.confidence) {
        bestWorkout = workout;
        bestCandidate = candidate;
      }
    }

    if (!bestWorkout || !bestCandidate) {
      matches.push({
        plannedSessionId: planned.id,
        status: 'missed',
        confidence: 0,
        reasoning: 'No matching workout found within the v1 date/type window.',
      });
      continue;
    }

    remainingWorkoutIds.delete(bestWorkout.id);
    matches.push({
      plannedSessionId: planned.id,
      workoutId: bestWorkout.id,
      status: bestCandidate.status,
      confidence: bestCandidate.confidence,
      reasoning: bestCandidate.reasoning,
    });
  }

  return {
    matches,
    unmatchedWorkoutIds: workouts.filter((workout) => remainingWorkoutIds.has(workout.id)).map((workout) => workout.id),
  };
}
