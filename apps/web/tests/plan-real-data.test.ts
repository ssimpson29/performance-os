import { describe, expect, it } from 'vitest';

import { buildPlanVsActualPreviewFromRecords } from '../app/plan/plan-vs-actual-data';

describe('buildPlanVsActualPreviewFromRecords', () => {
  it('builds informational preview rows from persisted plan and workout records', () => {
    const preview = buildPlanVsActualPreviewFromRecords({
      planName: 'Swiss Alps 100',
      plannedSessions: [
        {
          id: 'plan-1',
          sessionDate: '2026-02-07',
          title: 'Long Run',
          durationMinutes: 180,
        },
        {
          id: 'plan-2',
          sessionDate: '2026-02-09',
          title: 'Quality',
          durationMinutes: 60,
        },
      ],
      matches: [
        {
          plannedSessionId: 'plan-1',
          workoutId: 'workout-1',
          status: 'completed',
          confidence: 88,
          reasoning: 'same-day date match; duration closely matched',
        },
      ],
      workouts: [
        {
          id: 'workout-1',
          externalId: 'ah-1',
          workoutType: 'Trail Run',
          localDate: '2026-02-07',
          durationSeconds: 10200,
        },
        {
          id: 'workout-2',
          externalId: 'manual-2',
          workoutType: 'Strength Training',
          localDate: '2026-02-08',
          durationSeconds: 3000,
        },
      ],
    });

    expect(preview.dataSource).toBe('live');
    expect(preview.planName).toBe('Swiss Alps 100');
    expect(preview.sessions).toEqual([
      expect.objectContaining({
        plannedSessionId: 'plan-1',
        status: 'completed',
        actualWorkoutType: 'Trail Run',
        actualDurationMinutes: 170,
      }),
      expect.objectContaining({
        plannedSessionId: 'plan-2',
        status: 'missed',
      }),
    ]);
    expect(preview.offPlanWorkouts).toEqual([
      expect.objectContaining({
        externalId: 'manual-2',
        workoutType: 'Strength Training',
      }),
    ]);
    expect(preview.summary).toMatchObject({
      completed: 1,
      missed: 1,
      offPlan: 1,
    });
  });
});
