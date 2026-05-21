import type {
  AdaptedRecommendation,
  AdaptiveCoachInput,
  AdaptiveCoachResult,
  CompletedWorkout,
  FatigueState,
  PerformanceDelta,
  PerformanceSignal,
  PhaseBlock,
  PhasePosition,
  PlanAdaptation,
  PrescribedWeek,
  RecoverySample,
  RecoveryTrend,
  WeeklyStructureSession,
} from './types';

// ---------------------------------------------------------------------------
// Phase-of-plan calculation
// ---------------------------------------------------------------------------

function isoToUtcDate(value: string): Date | null {
  const trimmed = value.slice(0, 10);
  const parts = trimmed.split('-').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function diffWholeDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Compute the athlete's position in the plan given today + plan start + race
 * date + phase blocks. Returns null when any required input is missing or
 * invalid, so the caller can decide to skip race-aware logic.
 */
export function computePhasePosition(input: {
  today: string;
  planStartDate: string;
  raceDate: string;
  phaseBlocks: PhaseBlock[];
}): PhasePosition | null {
  const today = isoToUtcDate(input.today);
  const start = isoToUtcDate(input.planStartDate);
  const race = isoToUtcDate(input.raceDate);
  if (!today || !start || !race) return null;

  const daysSinceStart = diffWholeDays(today, start);
  const totalWeekIndex = Math.max(0, Math.floor(daysSinceStart / 7));

  const daysToRace = diffWholeDays(race, today);
  const weeksToRace = Math.max(0, Math.floor(daysToRace / 7));
  const isRaceWeek = daysToRace >= 0 && daysToRace < 7;

  // Walk phase blocks accumulating week counts to find which phase the
  // current totalWeekIndex lands in.
  let phaseName: string | null = null;
  let phaseIndex = -1;
  let weekIndexInPhase = -1;
  let accumulator = 0;
  for (let i = 0; i < input.phaseBlocks.length; i++) {
    const block = input.phaseBlocks[i];
    const blockWeeks = block.weeks.length;
    if (totalWeekIndex < accumulator + blockWeeks) {
      phaseName = block.phaseName;
      phaseIndex = i;
      weekIndexInPhase = totalWeekIndex - accumulator;
      break;
    }
    accumulator += blockWeeks;
  }

  const isTaper = phaseName != null && /taper/i.test(phaseName);
  // Raising load is permitted everywhere except taper, race week, and any
  // phase explicitly named "Race" or "Peak Race".
  const raiseAllowed = !isTaper && !isRaceWeek && phaseName != null;

  return {
    phaseName,
    phaseIndex,
    weekIndexInPhase,
    totalWeekIndex,
    weeksToRace,
    isRaceWeek,
    isTaper,
    raiseAllowed,
  };
}

// ---------------------------------------------------------------------------
// Recovery trend detection
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const sq = values.map((v) => (v - m) ** 2);
  return Math.sqrt(mean(sq));
}

/**
 * Classify recovery direction over the recent window. Single-outlier
 * resistant via mean comparison between earlier and later halves; confidence
 * scales with sample count and inverse coefficient-of-variation.
 */
export function computeRecoveryTrend(history: RecoverySample[]): RecoveryTrend {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const sampleCount = sorted.length;

  if (sampleCount === 0) {
    return { direction: 'stable', confidence: 0, sampleCount: 0 };
  }
  if (sampleCount < 3) {
    return { direction: 'stable', confidence: 0.1, sampleCount };
  }

  const half = Math.floor(sampleCount / 2);
  const earlier = sorted.slice(0, half).map((s) => s.score);
  const later = sorted.slice(sampleCount - half).map((s) => s.score);
  const delta = mean(later) - mean(earlier);
  const overallMean = mean(sorted.map((s) => s.score));
  const overallStd = stddev(sorted.map((s) => s.score));

  // Threshold: a "real" move is a delta of at least 4 recovery points,
  // and at least 0.5 * stddev to avoid flagging noise.
  const noiseFloor = Math.max(4, overallStd * 0.5);
  let direction: RecoveryTrend['direction'] = 'stable';
  if (delta > noiseFloor) direction = 'improving';
  else if (delta < -noiseFloor) direction = 'degrading';

  // Confidence: scales with sample count up to 7, and with signal-to-noise.
  const sampleBoost = Math.min(1, sampleCount / 7);
  const cv = overallMean > 0 ? overallStd / overallMean : 0;
  const noiseDiscount = Math.max(0, 1 - cv * 2);
  const confidence = Math.round(sampleBoost * noiseDiscount * 100) / 100;

  return { direction, confidence, sampleCount };
}

// ---------------------------------------------------------------------------
// Performance delta (prescribed vs. completed)
// ---------------------------------------------------------------------------

const OVER_THRESHOLD = 0.08; // +8% completed-vs-prescribed → "over"
const UNDER_THRESHOLD = -0.08; // -8% → "under"

function classifyDelta(volumeDelta: number | null, intensityDelta: number | null): PerformanceSignal {
  // Prefer volume signal; fall back to intensity. Null inputs → "on" (no info).
  const primary = volumeDelta ?? intensityDelta;
  if (primary == null) return 'on';
  if (primary > OVER_THRESHOLD) return 'over';
  if (primary < UNDER_THRESHOLD) return 'under';
  return 'on';
}

/**
 * Compare the rolling-window prescribed targets to what the athlete actually
 * completed. Returns null deltas when no prescription is provided.
 */
export function computePerformanceDelta(input: {
  prescribed?: PrescribedWeek;
  completed: CompletedWorkout[];
}): PerformanceDelta {
  const completedVolume = input.completed.reduce((s, w) => s + w.durationMinutes, 0);
  const completedIntensity = input.completed.length
    ? mean(input.completed.map((w) => w.intensityScore))
    : 0;

  const prescribedVolume = input.prescribed?.volumeTarget;
  const prescribedIntensity = input.prescribed?.intensityTarget;

  const volumeDelta =
    prescribedVolume && prescribedVolume > 0
      ? (completedVolume - prescribedVolume) / prescribedVolume
      : null;
  const intensityDelta =
    prescribedIntensity && prescribedIntensity > 0
      ? (completedIntensity - prescribedIntensity) / prescribedIntensity
      : null;

  return {
    volumeDelta,
    intensityDelta,
    signal: classifyDelta(volumeDelta, intensityDelta),
  };
}

// ---------------------------------------------------------------------------
// Weekend overload (existing behavior, preserved)
// ---------------------------------------------------------------------------

function scoreWorkout(workout: CompletedWorkout): number {
  return workout.loadScore + workout.durationMinutes * 0.35 + workout.intensityScore * 12;
}

function computeOverloadScore(workouts: CompletedWorkout[], recoveryScore?: number): number {
  const weekendScore = workouts.reduce((sum, workout) => sum + scoreWorkout(workout), 0);
  const stackedBonus = workouts.length >= 2 ? 90 : 0;
  const recoveryPenalty = recoveryScore == null ? 0 : Math.max(0, 70 - recoveryScore) * 4;
  return weekendScore + stackedBonus + recoveryPenalty;
}

function getFatigueState(overloadScore: number): FatigueState {
  if (overloadScore >= 560) return 'high';
  if (overloadScore >= 320) return 'elevated';
  return 'manageable';
}

function buildRecommendation(session: WeeklyStructureSession, fatigueState: FatigueState): AdaptedRecommendation {
  if (session.day === 'Monday') {
    if (fatigueState === 'high') {
      return {
        day: session.day,
        baseSessionType: session.runSession,
        recommendedSessionType: 'Recovery Run or Rest',
        action: 'downgrade',
        reason: 'Recent stacked workload is too high to preserve the base Monday aerobic plus lifting intent.',
      };
    }
    if (fatigueState === 'elevated') {
      return {
        day: session.day,
        baseSessionType: session.runSession,
        recommendedSessionType: 'Short Aerobic Run + Mobility',
        action: 'downgrade',
        reason: 'Use Monday to absorb weekend stress while preserving rhythm.',
      };
    }
  }

  if (session.day === 'Tuesday') {
    if (fatigueState === 'high') {
      return {
        day: session.day,
        baseSessionType: session.runSession,
        recommendedSessionType: 'Aerobic Run',
        action: 'defer-intensity',
        reason: 'Quality work is deferred because the athlete is still carrying high weekend fatigue.',
      };
    }
    if (fatigueState === 'elevated') {
      return {
        day: session.day,
        baseSessionType: session.runSession,
        recommendedSessionType: 'Controlled Tempo or Reduced Intervals',
        action: 'defer-intensity',
        reason: 'Keep Tuesday productive but reduce intensity until recovery stabilizes.',
      };
    }
  }

  return {
    day: session.day,
    baseSessionType: session.runSession,
    recommendedSessionType: session.runSession,
    action: 'keep',
    reason: 'Base weekly structure remains appropriate.',
  };
}

// ---------------------------------------------------------------------------
// Plan-level adapt-up / adapt-down
// ---------------------------------------------------------------------------

function computePlanAdaptation(args: {
  phasePosition: PhasePosition | undefined;
  recoveryTrend: RecoveryTrend | undefined;
  performanceDelta: PerformanceDelta | undefined;
  fatigueState: FatigueState;
}): PlanAdaptation | undefined {
  const { phasePosition, recoveryTrend, performanceDelta, fatigueState } = args;

  // Race week is locked: no plan-level adaptation regardless of signals.
  if (phasePosition?.isRaceWeek) {
    return {
      suggestion: 'hold',
      magnitudePct: 0,
      reason: 'Race week is locked. The plan is both floor and ceiling — deviations are flagged loudly.',
    };
  }

  // Taper never raises. It can lower if recovery is degrading.
  if (phasePosition?.isTaper) {
    if (recoveryTrend?.direction === 'degrading' && (recoveryTrend.confidence ?? 0) >= 0.4) {
      return {
        suggestion: 'lower',
        magnitudePct: -10,
        reason: 'In taper with recovery trending down; reduce remaining intensity to arrive fresh.',
      };
    }
    return {
      suggestion: 'hold',
      magnitudePct: 0,
      reason: 'Taper phase — defend the plan against impulse to do more.',
    };
  }

  // Adapt-down: lagging adherence OR degraded recovery OR high fatigue.
  const recoveryDegrading =
    recoveryTrend?.direction === 'degrading' && (recoveryTrend.confidence ?? 0) >= 0.4;
  const underPerforming = performanceDelta?.signal === 'under';
  if (recoveryDegrading || underPerforming || fatigueState === 'high') {
    const reasons: string[] = [];
    if (recoveryDegrading) reasons.push('recovery markers trending down');
    if (underPerforming) reasons.push('completed volume is meaningfully below the prescribed week');
    if (fatigueState === 'high') reasons.push('weekend overload is elevated');
    return {
      suggestion: 'lower',
      magnitudePct: -10,
      reason: `Lower next block's targets ~10% — ${reasons.join('; ')}.`,
    };
  }

  // Adapt-up: only when over-performing with healthy/improving recovery,
  // weekend fatigue is manageable, and the phase permits raises.
  const overPerforming = performanceDelta?.signal === 'over';
  const recoveryHealthy =
    recoveryTrend == null ||
    recoveryTrend.direction === 'improving' ||
    (recoveryTrend.direction === 'stable' && (recoveryTrend.confidence ?? 0) >= 0.3);
  if (
    overPerforming &&
    recoveryHealthy &&
    fatigueState === 'manageable' &&
    phasePosition?.raiseAllowed
  ) {
    // Magnitude: scale with how much the athlete is over the prescription,
    // capped at +12% so we don't lurch the plan in one block.
    const overshoot = Math.abs(performanceDelta?.volumeDelta ?? performanceDelta?.intensityDelta ?? 0.1);
    const magnitudePct = Math.min(12, Math.round(overshoot * 100 * 0.6));
    return {
      suggestion: 'raise',
      magnitudePct,
      reason:
        `Athlete is consistently completing more than the prescribed week with healthy/improving recovery in ${phasePosition.phaseName ?? 'the current phase'}; ` +
        `raise next block's targets by ~${magnitudePct}% to extract more performance toward the race goal.`,
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Per-day recommendation overrides from race-aware signals
// ---------------------------------------------------------------------------

function applyRaceAwareOverrides(
  base: AdaptedRecommendation,
  phasePosition: PhasePosition | undefined,
  recoveryTrend: RecoveryTrend | undefined,
): AdaptedRecommendation {
  // Race week: lock to the plan (no downgrades or raises in daily recs).
  if (phasePosition?.isRaceWeek) {
    return {
      day: base.day,
      baseSessionType: base.baseSessionType,
      recommendedSessionType: base.baseSessionType,
      action: 'keep',
      reason: 'Race week — execute the plan as written. The plan is both floor and ceiling.',
    };
  }

  // Taper: never raise; if base is already a downgrade, keep it; otherwise
  // append a taper-defense note to the existing reason.
  if (phasePosition?.isTaper && base.action === 'keep') {
    return {
      ...base,
      reason: `${base.reason} Taper phase — do not exceed prescribed work.`,
    };
  }

  // Degraded recovery with high confidence: push Tuesday quality down even if
  // weekend overload alone didn't trigger it.
  if (
    base.day === 'Tuesday' &&
    base.action === 'keep' &&
    recoveryTrend?.direction === 'degrading' &&
    (recoveryTrend.confidence ?? 0) >= 0.5
  ) {
    return {
      day: base.day,
      baseSessionType: base.baseSessionType,
      recommendedSessionType: 'Controlled Tempo or Reduced Intervals',
      action: 'defer-intensity',
      reason:
        'Recovery trend is degrading across the recent window; defer Tuesday quality until trend stabilizes.',
    };
  }

  return base;
}

// ---------------------------------------------------------------------------
// Top-level adaptive coach
// ---------------------------------------------------------------------------

export function adaptWeeklyStructure(input: AdaptiveCoachInput): AdaptiveCoachResult {
  const relevantDays = new Set(['Saturday', 'Sunday']);
  const recentWeekend = input.completedWorkouts.filter((workout) => relevantDays.has(workout.day));
  const overloadScore = computeOverloadScore(recentWeekend, input.recoveryScore);
  const fatigueState = getFatigueState(overloadScore);

  // Race-aware signals (each optional based on what the caller supplied).
  let phasePosition: PhasePosition | undefined;
  if (input.today && input.planStartDate && input.raceDate && input.phaseBlocks) {
    phasePosition =
      computePhasePosition({
        today: input.today,
        planStartDate: input.planStartDate,
        raceDate: input.raceDate,
        phaseBlocks: input.phaseBlocks,
      }) ?? undefined;
  }

  const recoveryTrend = input.recoveryHistory
    ? computeRecoveryTrend(input.recoveryHistory)
    : undefined;

  const performanceDelta = input.prescribedWeek
    ? computePerformanceDelta({
        prescribed: input.prescribedWeek,
        completed: input.completedWorkouts,
      })
    : undefined;

  const baseRecommendations = input.weeklyStructure
    .filter((session) => ['Monday', 'Tuesday'].includes(session.day))
    .map((session) => buildRecommendation(session, fatigueState));

  const recommendations = baseRecommendations.map((rec) =>
    applyRaceAwareOverrides(rec, phasePosition, recoveryTrend),
  );

  const planAdaptation = computePlanAdaptation({
    phasePosition,
    recoveryTrend,
    performanceDelta,
    fatigueState,
  });

  return {
    fatigueState,
    overloadScore,
    recommendations,
    phasePosition,
    recoveryTrend,
    performanceDelta,
    planAdaptation,
  };
}
