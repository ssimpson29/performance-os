import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  linkAppleRowsToStravaMatches,
  type AppleRowForMerge,
} from '../lib/workouts/apple-strava-merge';

/**
 * Phase 3 of the Strava integration: when an Apple workout is upserted, we
 * look for a pre-existing canonical Strava row that describes the same
 * session and (a) link it as `superseded_by` the Apple row, (b) forward its
 * description onto the Apple row. These tests cover the merge orchestration
 * — the matching rule itself is covered in duplicate-matching.test.ts.
 */

type StravaRow = {
  id: string;
  workout_type: string;
  started_at: string;
  duration_seconds: number | null;
  description: string | null;
  superseded_by: string | null;
};

function buildSupabase(args: {
  stravaRows: StravaRow[];
  updates: Array<{ id: string; values: Record<string, unknown> }>;
}) {
  const { stravaRows, updates } = args;
  return {
    from(table: string) {
      if (table !== 'workouts') throw new Error(`Unexpected table ${table}`);
      return {
        select() {
          // Mirror the .eq('user_id').eq('source','strava').is('superseded_by', null).gte().lte() chain.
          return {
            eq() {
              return {
                eq() {
                  return {
                    is() {
                      return {
                        gte() {
                          return {
                            lte: vi
                              .fn()
                              .mockResolvedValue({ data: stravaRows, error: null }),
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              updates.push({ id, values });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

describe('linkAppleRowsToStravaMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when there are no Apple rows in the batch', async () => {
    const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
    const supabase = buildSupabase({ stravaRows: [], updates });

    const result = await linkAppleRowsToStravaMatches(supabase as never, {
      userId: 'user-1',
      appleRows: [],
    });

    expect(result).toEqual({ linkedStravaRows: 0, forwardedDescriptions: 0 });
    expect(updates).toHaveLength(0);
  });

  it('links a Strava row to the Apple row and forwards the description', async () => {
    const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
    const stravaRows: StravaRow[] = [
      {
        id: 'strava-1',
        workout_type: 'TrailRun',
        started_at: '2026-05-15T13:00:30.000Z',
        duration_seconds: 3650,
        description: 'Strong climb on the last 5k',
        superseded_by: null,
      },
    ];
    const supabase = buildSupabase({ stravaRows, updates });

    const appleRows: AppleRowForMerge[] = [
      {
        id: 'apple-1',
        source: 'apple_watch',
        external_id: 'apple-external-1',
        workout_type: 'Outdoor Run',
        started_at: '2026-05-15T13:00:00.000Z',
        duration_seconds: 3600,
        description: null,
      },
    ];

    const result = await linkAppleRowsToStravaMatches(supabase as never, {
      userId: 'user-1',
      appleRows,
    });

    expect(result).toEqual({ linkedStravaRows: 1, forwardedDescriptions: 1 });
    // First update: link Strava row to Apple row.
    expect(updates).toContainEqual({
      id: 'strava-1',
      values: { superseded_by: 'apple-1' },
    });
    // Second update: forward Strava description onto Apple row.
    expect(updates).toContainEqual({
      id: 'apple-1',
      values: { description: 'Strong climb on the last 5k' },
    });
  });

  it('does not forward the description when the Apple row already has one', async () => {
    const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
    const stravaRows: StravaRow[] = [
      {
        id: 'strava-2',
        workout_type: 'Run',
        started_at: '2026-05-15T13:00:30.000Z',
        duration_seconds: 3650,
        description: 'Some strava note',
        superseded_by: null,
      },
    ];
    const supabase = buildSupabase({ stravaRows, updates });

    const result = await linkAppleRowsToStravaMatches(supabase as never, {
      userId: 'user-1',
      appleRows: [
        {
          id: 'apple-2',
          source: 'apple_watch',
          external_id: 'apple-ext-2',
          workout_type: 'Outdoor Run',
          started_at: '2026-05-15T13:00:00.000Z',
          duration_seconds: 3600,
          description: 'Athlete already wrote a note',
        },
      ],
    });

    expect(result).toEqual({ linkedStravaRows: 1, forwardedDescriptions: 0 });
    expect(updates.filter((u) => u.id === 'apple-2')).toHaveLength(0);
    expect(updates).toContainEqual({ id: 'strava-2', values: { superseded_by: 'apple-2' } });
  });

  it('is a no-op when no Strava rows match the Apple session', async () => {
    const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
    // Strava row exists but is a *Ride*, not a run — different family.
    const stravaRows: StravaRow[] = [
      {
        id: 'strava-3',
        workout_type: 'Ride',
        started_at: '2026-05-15T13:00:30.000Z',
        duration_seconds: 3600,
        description: 'Cycle commute',
        superseded_by: null,
      },
    ];
    const supabase = buildSupabase({ stravaRows, updates });

    const result = await linkAppleRowsToStravaMatches(supabase as never, {
      userId: 'user-1',
      appleRows: [
        {
          id: 'apple-3',
          source: 'apple_watch',
          external_id: 'apple-ext-3',
          workout_type: 'Outdoor Run',
          started_at: '2026-05-15T13:00:00.000Z',
          duration_seconds: 3600,
          description: null,
        },
      ],
    });

    expect(result).toEqual({ linkedStravaRows: 0, forwardedDescriptions: 0 });
    expect(updates).toHaveLength(0);
  });

  it('does not claim the same Strava row for two Apple rows in the batch', async () => {
    const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
    // One Strava row, two Apple rows that both fall within ±2 minutes of it.
    // Only the first Apple row should claim it.
    const stravaRows: StravaRow[] = [
      {
        id: 'strava-4',
        workout_type: 'Run',
        started_at: '2026-05-15T13:00:00.000Z',
        duration_seconds: 3600,
        description: 'Note',
        superseded_by: null,
      },
    ];
    const supabase = buildSupabase({ stravaRows, updates });

    const result = await linkAppleRowsToStravaMatches(supabase as never, {
      userId: 'user-1',
      appleRows: [
        {
          id: 'apple-4a',
          source: 'apple_watch',
          external_id: 'a',
          workout_type: 'Outdoor Run',
          started_at: '2026-05-15T13:00:00.000Z',
          duration_seconds: 3600,
          description: null,
        },
        {
          id: 'apple-4b',
          source: 'apple_watch',
          external_id: 'b',
          workout_type: 'Outdoor Run',
          started_at: '2026-05-15T13:00:30.000Z',
          duration_seconds: 3600,
          description: null,
        },
      ],
    });

    expect(result.linkedStravaRows).toBe(1);
    // Only the strava-4 row should be linked, and only to apple-4a.
    const stravaLinkUpdates = updates.filter((u) => u.id === 'strava-4');
    expect(stravaLinkUpdates).toHaveLength(1);
    expect(stravaLinkUpdates[0].values).toEqual({ superseded_by: 'apple-4a' });
  });
});
