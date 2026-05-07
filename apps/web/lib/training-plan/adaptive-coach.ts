import type { AdaptedRecommendation, AdaptiveCoachInput, AdaptiveCoachResult, CompletedWorkout, FatigueState, WeeklyStructureSession } from './types';

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

export function adaptWeeklyStructure(input: AdaptiveCoachInput): AdaptiveCoachResult {
  const relevantDays = new Set(['Saturday', 'Sunday']);
  const recentWeekend = input.completedWorkouts.filter((workout) => relevantDays.has(workout.day));
  const overloadScore = computeOverloadScore(recentWeekend, input.recoveryScore);
  const fatigueState = getFatigueState(overloadScore);

  const recommendations = input.weeklyStructure
    .filter((session) => ['Monday', 'Tuesday'].includes(session.day))
    .map((session) => buildRecommendation(session, fatigueState));

  return {
    fatigueState,
    overloadScore,
    recommendations,
  };
}
