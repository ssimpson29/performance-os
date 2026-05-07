import { describe, expect, it } from 'vitest';

import { normalizeActualWorkouts } from '../lib/training-plan/workout-ingestion';

describe('normalizeActualWorkouts', () => {
  it('fills derived fields for workout ingestion payloads', () => {
    const workouts = normalizeActualWorkouts([
      {
        source: 'apple_health',
        workoutType: 'Outdoor Run',
        startedAt: '2026-02-07T14:00:00.000Z',
        endedAt: '2026-02-07T16:30:00.000Z',
        distanceMeters: 32000,
        metadata: { device: 'Apple Watch Ultra' },
      },
    ]);

    expect(workouts).toHaveLength(1);
    expect(workouts[0]).toMatchObject({
      externalId: 'apple_health:2026-02-07T14:00:00.000Z:Outdoor Run',
      localDate: '2026-02-07',
      durationSeconds: 9000,
      distanceMeters: 32000,
      metadata: { device: 'Apple Watch Ultra' },
    });
  });

  it('preserves explicit external ids, local dates, and durations when provided', () => {
    const workouts = normalizeActualWorkouts([
      {
        externalId: 'workout-123',
        source: 'manual',
        workoutType: 'Strength Training',
        startedAt: '2026-02-08T18:00:00.000Z',
        localDate: '2026-02-09',
        durationSeconds: 2700,
      },
    ]);

    expect(workouts[0]).toMatchObject({
      externalId: 'workout-123',
      localDate: '2026-02-09',
      durationSeconds: 2700,
    });
  });
});
