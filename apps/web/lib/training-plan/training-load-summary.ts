import type { CompletedWorkout } from './types';

/**
 * Aggregate training-load summary over a set of completed workouts. Shared by
 * the Longevity Guru's getRecentWorkouts tool (conversational path) and the
 * single-shot /api/longevity/evaluate path so both reason about load
 * identically. Pure — no I/O.
 */
export type TrainingLoadSummary = {
  totalSessions: number;
  totalDurationMinutes: number;
  totalDistanceMeters: number;
  totalElevationGainM: number;
  /** null when no source recorded energy for any session. */
  totalEnergyKcal: number | null;
  totalLoadScore: number;
  /** Sessions with intensityScore >= 7 OR perceived exertion >= 7. */
  hardSessions: number;
  longestSessionMinutes: number;
  /** Distinct calendar days with at least one session. */
  daysTrained: number;
};

export function summarizeTrainingLoad(workouts: CompletedWorkout[]): TrainingLoadSummary {
  const sum = (fn: (w: CompletedWorkout) => number | null | undefined) =>
    workouts.reduce((acc, w) => acc + (fn(w) ?? 0), 0);
  const totalEnergyKcal = Math.round(sum((w) => w.energyKcal));

  return {
    totalSessions: workouts.length,
    totalDurationMinutes: Math.round(sum((w) => w.durationMinutes)),
    totalDistanceMeters: Math.round(sum((w) => w.distanceMeters)),
    totalElevationGainM: Math.round(sum((w) => w.elevationGainM)),
    totalEnergyKcal: totalEnergyKcal || null,
    totalLoadScore: Math.round(sum((w) => w.loadScore)),
    hardSessions: workouts.filter((w) => (w.intensityScore ?? 0) >= 7 || (w.perceivedExertion ?? 0) >= 7).length,
    longestSessionMinutes: workouts.reduce((m, w) => Math.max(m, w.durationMinutes ?? 0), 0),
    daysTrained: new Set(workouts.map((w) => w.localDate ?? w.day)).size,
  };
}

/**
 * One-line prose rendering for inlining into a prompt (the single-shot guru
 * has no tool loop, so it can't fetch detail — it gets this summary inline).
 */
export function formatTrainingLoadSummary(s: TrainingLoadSummary, lookbackDays: number): string {
  if (s.totalSessions === 0) {
    return `Recent training (last ${lookbackDays} days): none logged.`;
  }
  const hrs = (s.totalDurationMinutes / 60).toFixed(1);
  const km = (s.totalDistanceMeters / 1000).toFixed(1);
  const parts = [
    `${s.totalSessions} sessions across ${s.daysTrained} days`,
    `${hrs}h`,
    `${km} km`,
    `${s.totalElevationGainM} m vert`,
  ];
  if (s.totalEnergyKcal) parts.push(`~${s.totalEnergyKcal} kcal expended`);
  parts.push(`${s.hardSessions} hard session${s.hardSessions === 1 ? '' : 's'}`);
  parts.push(`longest ${s.longestSessionMinutes} min`);
  return `Recent training load (last ${lookbackDays} days): ${parts.join(', ')}.`;
}
