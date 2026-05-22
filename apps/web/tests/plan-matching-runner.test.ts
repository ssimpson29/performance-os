import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyPlanMatchingForUserDateRange } from '../lib/training-plan/plan-matching-runner';

/**
 * The plan-matching runner is the bridge between the Strava sync path
 * (processStravaActivity, which inserts workouts but doesn't touch
 * plan_workout_matches) and the planned-session UI. Tests verify it:
 *   - no-ops when no planned sessions exist in the range,
 *   - clears stale matches before inserting fresh ones,
 *   - matches a same-day same-family workout to a planned session,
 *   - filters non-canonical (superseded) workouts via .is('superseded_by', null).
 */

type Captured = {
  plannedSessionsDeletedIds?: string[];
  matchesInserted?: Array<Record<string, unknown>>;
  workoutsSelectChain?: { isCol?: string; isVal?: unknown };
};

function buildSupabase(args: {
  plannedSessions: Array<Record<string, unknown>>;
  workouts: Array<Record<string, unknown>>;
  captured: Captured;
}) {
  const { plannedSessions, workouts, captured } = args;
  return {
    from(table: string) {
      if (table === 'planned_sessions') {
        return {
          select() {
            return {
              eq() {
                return {
                  gte() {
                    return {
                      lte() {
                        return {
                          order: vi
                            .fn()
                            .mockResolvedValue({ data: plannedSessions, error: null }),
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'workouts') {
        return {
          select() {
            return {
              eq() {
                return {
                  is(col: string, val: unknown) {
                    captured.workoutsSelectChain = { isCol: col, isVal: val };
                    return {
                      gte() {
                        return {
                          lte: vi
                            .fn()
                            .mockResolvedValue({ data: workouts, error: null }),
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'plan_workout_matches') {
        return {
          delete() {
            return {
              in(_col: string, ids: string[]) {
                captured.plannedSessionsDeletedIds = ids;
                return Promise.resolve({ error: null });
              },
            };
          },
          insert(rows: Array<Record<string, unknown>>) {
            captured.matchesInserted = rows;
            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe('applyPlanMatchingForUserDateRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-ops when no planned sessions exist in the window', async () => {
    const captured: Captured = {};
    const supabase = buildSupabase({ plannedSessions: [], workouts: [], captured });

    const result = await applyPlanMatchingForUserDateRange(supabase as never, {
      userId: 'user-1',
      fromDate: '2026-05-18',
      toDate: '2026-05-25',
    });

    expect(result).toEqual({ matchedCount: 0, plannedSessionCount: 0, workoutCount: 0 });
    expect(captured.plannedSessionsDeletedIds).toBeUndefined();
    expect(captured.matchesInserted).toBeUndefined();
  });

  it('matches a same-day Strava Run to a planned Aerobic Run and inserts the match row', async () => {
    const captured: Captured = {};
    const supabase = buildSupabase({
      plannedSessions: [
        {
          id: 'planned-monday',
          session_date: '2026-05-18',
          title: 'Aerobic Run',
          discipline: 'Run',
          duration_minutes: null,
          // Keep objective/notes free of 'easy' / 'quality' / 'long' so the
          // matcher's classifier lands on the 'run' family directly.
          objective: 'Aerobic base mileage',
          notes: '',
          metadata: {},
        },
      ],
      workouts: [
        {
          id: 'strava-run-1',
          external_id: 'strava-555',
          source: 'strava',
          workout_type: 'Run',
          started_at: '2026-05-18T13:00:00.000Z',
          local_date: '2026-05-18',
          duration_seconds: 5400, // 90 min
          distance_meters: 18000,
          metadata: {},
        },
      ],
      captured,
    });

    const result = await applyPlanMatchingForUserDateRange(supabase as never, {
      userId: 'user-1',
      fromDate: '2026-05-18',
      toDate: '2026-05-22',
    });

    expect(result.plannedSessionCount).toBe(1);
    expect(result.workoutCount).toBe(1);
    expect(result.matchedCount).toBe(1);
    expect(captured.plannedSessionsDeletedIds).toEqual(['planned-monday']);
    expect(captured.matchesInserted).toEqual([
      expect.objectContaining({
        user_id: 'user-1',
        planned_session_id: 'planned-monday',
        workout_id: 'strava-run-1',
        status: 'completed',
      }),
    ]);
  });

  it('clears stale matches but inserts nothing when no workouts are in range', async () => {
    const captured: Captured = {};
    const supabase = buildSupabase({
      plannedSessions: [
        {
          id: 'planned-tuesday',
          session_date: '2026-05-19',
          title: 'Quality',
          discipline: 'Quality',
          duration_minutes: 75,
          objective: 'Tempo',
          notes: '',
          metadata: {},
        },
      ],
      workouts: [],
      captured,
    });

    const result = await applyPlanMatchingForUserDateRange(supabase as never, {
      userId: 'user-1',
      fromDate: '2026-05-18',
      toDate: '2026-05-22',
    });

    expect(result.plannedSessionCount).toBe(1);
    expect(result.workoutCount).toBe(0);
    expect(result.matchedCount).toBe(0);
    expect(captured.plannedSessionsDeletedIds).toEqual(['planned-tuesday']);
    expect(captured.matchesInserted).toBeUndefined();
  });

  it('filters the workouts query to canonical rows via .is("superseded_by", null)', async () => {
    const captured: Captured = {};
    const supabase = buildSupabase({
      plannedSessions: [
        {
          id: 'planned-x',
          session_date: '2026-05-22',
          title: 'Strength Day',
          discipline: 'Strength',
          duration_minutes: 45,
          objective: '',
          notes: '',
          metadata: {},
        },
      ],
      workouts: [],
      captured,
    });

    await applyPlanMatchingForUserDateRange(supabase as never, {
      userId: 'user-1',
      fromDate: '2026-05-18',
      toDate: '2026-05-22',
    });

    expect(captured.workoutsSelectChain).toEqual({ isCol: 'superseded_by', isVal: null });
  });
});
