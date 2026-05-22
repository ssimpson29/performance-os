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

  it('tags future planned sessions as upcoming, not missed', () => {
    const preview = buildPlanVsActualPreviewFromRecords({
      today: '2026-05-22',
      planName: 'Swiss Alps 100',
      plannedSessions: [
        // Past, unmatched -> missed
        { id: 'past-1', sessionDate: '2026-05-18', title: 'Aerobic Run', durationMinutes: 60 },
        // Today, unmatched -> missed (date is not in the future)
        { id: 'today-1', sessionDate: '2026-05-22', title: 'Strength Day', durationMinutes: 45 },
        // Future -> upcoming
        { id: 'future-1', sessionDate: '2026-05-25', title: 'Long Run', durationMinutes: 240 },
        { id: 'future-2', sessionDate: '2026-08-07', title: 'Race Day', durationMinutes: 1200 },
      ],
      matches: [],
      workouts: [],
    });

    const byId = Object.fromEntries(preview.sessions.map((s) => [s.plannedSessionId, s.status]));
    expect(byId['past-1']).toBe('missed');
    expect(byId['today-1']).toBe('missed');
    expect(byId['future-1']).toBe('upcoming');
    expect(byId['future-2']).toBe('upcoming');

    expect(preview.summary).toMatchObject({
      missed: 2,
      upcoming: 2,
      completed: 0,
    });
  });

  it('keeps a matched future session in its matcher-supplied status', () => {
    // The matcher occasionally links a workout logged a day before the
    // planned session date (e.g. a Sunday workout matched to a Monday
    // session). When that happens, the matched status takes precedence over
    // the upcoming heuristic.
    const preview = buildPlanVsActualPreviewFromRecords({
      today: '2026-05-22',
      planName: 'Swiss Alps 100',
      plannedSessions: [
        { id: 'monday', sessionDate: '2026-05-25', title: 'Aerobic Run', durationMinutes: 60 },
      ],
      matches: [
        {
          plannedSessionId: 'monday',
          workoutId: 'workout-early',
          status: 'completed',
          confidence: 70,
          reasoning: 'one-day-early match',
        },
      ],
      workouts: [
        {
          id: 'workout-early',
          externalId: 'apple-early',
          workoutType: 'Outdoor Run',
          localDate: '2026-05-24',
          durationSeconds: 3600,
        },
      ],
    });

    expect(preview.sessions[0].status).toBe('completed');
    expect(preview.summary).toMatchObject({
      completed: 1,
      missed: 0,
      upcoming: 0,
    });
  });
});
