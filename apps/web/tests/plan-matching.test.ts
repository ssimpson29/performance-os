import { describe, expect, it } from 'vitest';

import { matchPlannedSessionsToWorkouts } from '../lib/training-plan/plan-matching';
import type { ActualWorkoutForMatching, PlannedSessionForMatching } from '../lib/training-plan/types';

const plannedSessions: PlannedSessionForMatching[] = [
  {
    id: 'planned-long',
    sessionDate: '2026-02-07',
    title: 'Long Run',
    discipline: 'Long Run',
    durationMinutes: 180,
    objective: 'Steady uphill aerobic work',
    notes: 'Target 3h with vert',
  },
  {
    id: 'planned-quality',
    sessionDate: '2026-02-10',
    title: 'Quality',
    discipline: 'Quality',
    durationMinutes: 75,
    objective: 'Tempo intervals',
    notes: 'Threshold work',
  },
  {
    id: 'planned-recovery',
    sessionDate: '2026-02-11',
    title: 'Recovery Run',
    discipline: 'Recovery Run',
    durationMinutes: 45,
    objective: 'Easy shakeout',
  },
];

const workouts: ActualWorkoutForMatching[] = [
  {
    id: 'workout-long',
    externalId: '1',
    source: 'apple_health',
    workoutType: 'Outdoor Run',
    startedAt: '2026-02-07T14:00:00.000Z',
    localDate: '2026-02-07',
    durationSeconds: 10440,
    distanceMeters: 30000,
  },
  {
    id: 'workout-quality-short',
    externalId: '2',
    source: 'apple_health',
    workoutType: 'Outdoor Run',
    startedAt: '2026-02-10T12:00:00.000Z',
    localDate: '2026-02-10',
    durationSeconds: 2400,
  },
  {
    id: 'workout-sub',
    externalId: '3',
    source: 'manual',
    workoutType: 'Hiking',
    startedAt: '2026-02-11T15:30:00.000Z',
    localDate: '2026-02-11',
    durationSeconds: 5400,
  },
  {
    id: 'workout-off-plan',
    externalId: '4',
    source: 'manual',
    workoutType: 'Strength Training',
    startedAt: '2026-02-12T18:00:00.000Z',
    localDate: '2026-02-12',
    durationSeconds: 3600,
  },
];

describe('matchPlannedSessionsToWorkouts', () => {
  it('classifies completed, partial, substituted, and unmatched workouts for a v1 matching pass', () => {
    const summary = matchPlannedSessionsToWorkouts(plannedSessions, workouts);

    expect(summary.matches).toEqual([
      expect.objectContaining({
        plannedSessionId: 'planned-long',
        workoutId: 'workout-long',
        status: 'completed',
      }),
      expect.objectContaining({
        plannedSessionId: 'planned-quality',
        workoutId: 'workout-quality-short',
        status: 'partial',
      }),
      expect.objectContaining({
        plannedSessionId: 'planned-recovery',
        workoutId: 'workout-sub',
        status: 'substituted',
      }),
    ]);
    expect(summary.unmatchedWorkoutIds).toEqual(['workout-off-plan']);
  });

  it('marks a planned session as missed when no credible workout candidate exists', () => {
    const summary = matchPlannedSessionsToWorkouts(plannedSessions.slice(0, 1), []);

    expect(summary.matches).toEqual([
      expect.objectContaining({
        plannedSessionId: 'planned-long',
        status: 'missed',
      }),
    ]);
    expect(summary.unmatchedWorkoutIds).toEqual([]);
  });

  it('links a Strava "WeightTraining" workout to a planned strength session', () => {
    // Strava reports weights as 'WeightTraining' (no space); Apple Health
    // reports 'Strength Training'. Both should resolve to the same family.
    const planned: PlannedSessionForMatching[] = [
      {
        id: 'planned-strength',
        sessionDate: '2026-05-22',
        title: 'Strength Day A',
        discipline: 'Strength',
        durationMinutes: 45,
        objective: 'Posterior chain focus',
      },
    ];
    const actuals: ActualWorkoutForMatching[] = [
      {
        id: 'strava-weights',
        externalId: 'strava-1',
        source: 'strava',
        workoutType: 'WeightTraining',
        startedAt: '2026-05-22T13:00:00.000Z',
        localDate: '2026-05-22',
        durationSeconds: 2040, // 34 min — matches your real Strava activity
      },
    ];

    const summary = matchPlannedSessionsToWorkouts(planned, actuals);
    expect(summary.matches).toEqual([
      expect.objectContaining({
        plannedSessionId: 'planned-strength',
        workoutId: 'strava-weights',
        status: 'completed',
      }),
    ]);
    expect(summary.unmatchedWorkoutIds).toEqual([]);
  });

  it('links a Strava TrailRun to a planned "Trail Vert Session" (ultra-vocabulary)', () => {
    // The Swiss Alps plan names its vert day "Trail Vert Session". None of
    // the words 'run', 'aerobic', 'endurance' appear, but Strava reports the
    // activity as 'TrailRun'. The classifier needs to bridge the vocabulary.
    const planned: PlannedSessionForMatching[] = [
      {
        id: 'planned-vert',
        sessionDate: '2026-05-21',
        title: 'Trail Vert Session',
        discipline: 'Trail Vert Session',
        durationMinutes: null,
        objective: 'Climbing-focused day, target plan vert',
      },
    ];
    const actuals: ActualWorkoutForMatching[] = [
      {
        id: 'strava-trail',
        externalId: 'strava-9001',
        source: 'strava',
        workoutType: 'TrailRun',
        startedAt: '2026-05-21T13:00:00.000Z',
        localDate: '2026-05-21',
        durationSeconds: 10500, // 175 min
        distanceMeters: 24270,
      },
    ];

    const summary = matchPlannedSessionsToWorkouts(planned, actuals);
    expect(summary.matches).toEqual([
      expect.objectContaining({
        plannedSessionId: 'planned-vert',
        workoutId: 'strava-trail',
        status: 'completed',
      }),
    ]);
    expect(summary.unmatchedWorkoutIds).toEqual([]);
  });

  it('keeps "Trail Hike" classified as a hike, not accidentally as a run', () => {
    // The objective intentionally avoids 'easy' / 'recovery' (those trigger
    // the recovery classifier, which runs before hike). The point of this
    // test is the hike-vs-run discrimination: even though my extended run
    // regex includes 'trail', the hike branch is checked FIRST so 'Trail
    // Hike' lands as hike, not run.
    const planned: PlannedSessionForMatching[] = [
      {
        id: 'planned-hike',
        sessionDate: '2026-05-21',
        title: 'Trail Hike',
        discipline: 'Hike',
        durationMinutes: 120,
        objective: 'Moderate effort with elevation',
      },
    ];
    const actuals: ActualWorkoutForMatching[] = [
      {
        id: 'strava-hike',
        externalId: 'strava-hike-1',
        source: 'strava',
        workoutType: 'Hike',
        startedAt: '2026-05-21T13:00:00.000Z',
        localDate: '2026-05-21',
        durationSeconds: 7200,
      },
    ];

    const summary = matchPlannedSessionsToWorkouts(planned, actuals);
    expect(summary.matches).toEqual([
      expect.objectContaining({
        plannedSessionId: 'planned-hike',
        workoutId: 'strava-hike',
        status: 'completed',
      }),
    ]);
  });
});
