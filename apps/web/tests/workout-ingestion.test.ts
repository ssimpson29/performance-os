import { describe, expect, it } from 'vitest';

import {
  matchPlannedSessionsToWorkouts,
  normalizeActualWorkoutPayload,
  type PlannedSessionForMatching,
} from '../lib/training-plan/workout-ingestion';

const plannedSessions: PlannedSessionForMatching[] = [
  {
    id: 'plan-1',
    sessionDate: '2026-02-07',
    title: 'Long Run',
    discipline: 'Long Run',
    durationMinutes: 180,
  },
  {
    id: 'plan-2',
    sessionDate: '2026-02-09',
    title: 'Quality Session',
    discipline: 'Quality',
    durationMinutes: 60,
  },
  {
    id: 'plan-3',
    sessionDate: '2026-02-10',
    title: 'Recovery Run',
    discipline: 'Recovery Run',
    durationMinutes: 45,
  },
];

describe('normalizeActualWorkoutPayload', () => {
  it('normalizes structured workout imports into persisted workout rows', () => {
    const normalized = normalizeActualWorkoutPayload({
      userId: 'user-1',
      workouts: [
        {
          source: 'apple_health',
          externalId: ' ah-123 ',
          workoutType: ' Trail Run ',
          startedAt: '2026-02-07T14:00:00Z',
          endedAt: '2026-02-07T16:30:00Z',
          distanceMeters: 32000,
          metadata: {
            device: 'Apple Watch Ultra',
          },
        },
      ],
    });

    expect(normalized.userId).toBe('user-1');
    expect(normalized.workouts[0]).toMatchObject({
      userId: 'user-1',
      source: 'apple_health',
      externalId: 'ah-123',
      workoutType: 'Trail Run',
      startedAt: '2026-02-07T14:00:00.000Z',
      endedAt: '2026-02-07T16:30:00.000Z',
      localDate: '2026-02-07',
      durationSeconds: 9000,
      distanceMeters: 32000,
    });
    expect(normalized.workouts[0].rawPayload).toMatchObject({
      externalId: ' ah-123 ',
      workoutType: ' Trail Run ',
    });
  });
});

describe('matchPlannedSessionsToWorkouts', () => {
  it('classifies completed, partial, substituted, and missed sessions with transparent heuristics', () => {
    const normalized = normalizeActualWorkoutPayload({
      userId: 'user-1',
      workouts: [
        {
          source: 'apple_health',
          externalId: 'long-run',
          workoutType: 'Trail Run',
          startedAt: '2026-02-07T14:00:00Z',
          durationMinutes: 170,
        },
        {
          source: 'manual',
          externalId: 'quality-lite',
          workoutType: 'Interval Run',
          startedAt: '2026-02-09T12:00:00Z',
          durationMinutes: 30,
        },
        {
          source: 'apple_watch',
          externalId: 'bike-sub',
          workoutType: 'Cycling',
          startedAt: '2026-02-10T12:00:00Z',
          durationMinutes: 48,
        },
      ],
    });

    const result = matchPlannedSessionsToWorkouts({
      plannedSessions,
      actualWorkouts: normalized.workouts,
    });

    expect(result.matches).toHaveLength(3);
    expect(result.matches[0]).toMatchObject({
      plannedSessionId: 'plan-1',
      workoutExternalId: 'long-run',
      status: 'completed',
    });
    expect(result.matches[0].reasoning).toContain('date');
    expect(result.matches[1]).toMatchObject({
      plannedSessionId: 'plan-2',
      workoutExternalId: 'quality-lite',
      status: 'partial',
    });
    expect(result.matches[2]).toMatchObject({
      plannedSessionId: 'plan-3',
      workoutExternalId: 'bike-sub',
      status: 'substituted',
    });
    expect(result.missedSessions).toEqual([]);
    expect(result.unmatchedWorkoutExternalIds).toEqual([]);
    expect(result.summary).toEqual({
      completed: 1,
      partial: 1,
      substituted: 1,
      missed: 0,
      matched: 3,
      unmatchedActual: 0,
    });
  });

  it('marks sessions as missed when no viable workout match exists', () => {
    const normalized = normalizeActualWorkoutPayload({
      userId: 'user-1',
      workouts: [
        {
          source: 'manual',
          externalId: 'far-away',
          workoutType: 'Strength',
          startedAt: '2026-02-14T12:00:00Z',
          durationMinutes: 50,
        },
      ],
    });

    const result = matchPlannedSessionsToWorkouts({
      plannedSessions: plannedSessions.slice(0, 1),
      actualWorkouts: normalized.workouts,
    });

    expect(result.matches).toEqual([]);
    expect(result.missedSessions).toMatchObject([
      {
        plannedSessionId: 'plan-1',
        status: 'missed',
      },
    ]);
    expect(result.unmatchedWorkoutExternalIds).toEqual(['far-away']);
    expect(result.summary).toEqual({
      completed: 0,
      partial: 0,
      substituted: 0,
      missed: 1,
      matched: 0,
      unmatchedActual: 1,
    });
  });
});
