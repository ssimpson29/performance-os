import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StravaSyncError, syncStravaActivities } from '../lib/strava/activity-sync';

/**
 * Tests cover the matcher-driven orchestration in lib/strava/activity-sync.ts:
 *   - happy path inserts new Strava workout rows
 *   - duplicate against an Apple-sourced workout sets superseded_by and forwards the
 *     Strava description onto the canonical Apple row
 *   - second sync of the same Strava activity is idempotent (no duplicate insert)
 *   - expired token triggers a refresh before fetching activities
 *
 * Strava fetch mock helper: the batch sync makes TWO kinds of GET calls —
 * the summary list (/athlete/activities) and per-activity detail
 * (/activities/{id}). The summary returns an array; the detail returns a
 * single object. `mockStravaFetch` routes based on URL so individual tests
 * just provide the activity list.
 */

function mockStravaFetch(activities: Array<Record<string, unknown>>) {
  return vi.fn(async (url: unknown) => {
    const u = String(url ?? '');
    if (u.includes('/athlete/activities')) {
      return {
        ok: true,
        status: 200,
        json: async () => activities,
        text: async () => JSON.stringify(activities),
      } as Response;
    }
    if (u.includes('/api/v3/activities/')) {
      // /api/v3/activities/{id} → return the matching detail.
      const idPart = u.split('/api/v3/activities/')[1]?.split('?')[0] ?? '';
      const match = activities.find((a) => String(a.id) === idPart);
      const payload = match ?? activities[0] ?? null;
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as Response;
    }
    return { ok: false, status: 404, text: async () => 'not mocked' } as Response;
  });
}

type WorkoutRow = {
  id: string;
  source: string;
  external_id: string;
  workout_type: string;
  started_at: string;
  duration_seconds: number | null;
  description: string | null;
  superseded_by: string | null;
};

function buildSupabase(args: {
  integration: {
    id: string;
    access_token: string;
    refresh_token: string;
    token_expires_at: string;
    last_synced_at: string | null;
    external_user_id?: string | null;
  };
  existingWorkouts: WorkoutRow[];
  inserts: Array<Record<string, unknown>>;
  updates: Array<{ table: string; values: Record<string, unknown>; id?: string }>;
}) {
  const { integration, existingWorkouts, inserts, updates } = args;
  return {
    from(table: string) {
      if (table === 'user_integrations') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      limit() {
                        return {
                          maybeSingle: vi.fn().mockResolvedValue({
                            data: {
                              id: integration.id,
                              access_token_encrypted: integration.access_token,
                              refresh_token_encrypted: integration.refresh_token,
                              token_expires_at: integration.token_expires_at,
                              external_user_id: integration.external_user_id ?? null,
                              last_synced_at: integration.last_synced_at,
                              metadata: null,
                            },
                            error: null,
                          }),
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
                updates.push({ table, values, id });
                return Promise.resolve({ error: null });
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
                  gte: vi.fn().mockResolvedValue({ data: existingWorkouts, error: null }),
                };
              },
            };
          },
          insert(values: Record<string, unknown>) {
            inserts.push(values);
            return Promise.resolve({ error: null });
          },
          update(values: Record<string, unknown>) {
            return {
              eq(_col: string, id: string) {
                updates.push({ table, values, id });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe('syncStravaActivities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts new Strava activities when no Apple match exists', async () => {
    vi.stubGlobal(
      'fetch',
      mockStravaFetch([
        {
          id: 555,
          name: 'Easy lap',
          type: 'Run',
          sport_type: 'Run',
          description: 'Felt smooth',
          start_date: '2026-05-15T13:00:00.000Z',
          start_date_local: '2026-05-15T06:00:00.000Z',
          moving_time: 3600,
          distance: 12000,
          average_heartrate: 142,
          max_heartrate: 162,
          total_elevation_gain: 180,
        },
      ]),
    );

    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ table: string; values: Record<string, unknown>; id?: string }> = [];
    const supabase = buildSupabase({
      integration: {
        id: 'integration-1',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expires_at: '2099-01-01T00:00:00.000Z',
        last_synced_at: null,
      },
      existingWorkouts: [],
      inserts,
      updates,
    });

    const result = await syncStravaActivities(supabase as never, {
      userId: 'user-1',
      clientId: 'client',
      clientSecret: 'secret',
      options: { now: new Date('2026-05-16T00:00:00.000Z').getTime() },
    });

    expect(result).toMatchObject({
      ok: true,
      activitiesFetched: 1,
      workoutsInserted: 1,
      workoutsLinkedToApple: 0,
      workoutsAlreadyPresent: 0,
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      user_id: 'user-1',
      source: 'strava',
      external_id: '555',
      description: 'Felt smooth',
      superseded_by: null,
    });
    // last_synced_at should have been updated.
    expect(updates.some((u) => u.table === 'user_integrations' && 'last_synced_at' in u.values)).toBe(true);
  });

  it('links the Strava row to a matching Apple-sourced workout and forwards the description', async () => {
    vi.stubGlobal(
      'fetch',
      mockStravaFetch([
        {
          id: 999,
          name: 'Trail run',
          type: 'Run',
          sport_type: 'TrailRun',
          description: 'Strong climb on the last 5k',
          start_date: '2026-05-15T13:00:30.000Z', // 30s after the Apple row
          start_date_local: '2026-05-15T06:00:30.000Z',
          moving_time: 3650,
          distance: 12500,
        },
      ]),
    );

    const appleRow: WorkoutRow = {
      id: 'apple-1',
      source: 'apple_watch',
      external_id: 'apple-external-1',
      workout_type: 'Outdoor Run',
      started_at: '2026-05-15T13:00:00.000Z',
      duration_seconds: 3600,
      description: null,
      superseded_by: null,
    };

    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ table: string; values: Record<string, unknown>; id?: string }> = [];
    const supabase = buildSupabase({
      integration: {
        id: 'integration-1',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expires_at: '2099-01-01T00:00:00.000Z',
        last_synced_at: null,
      },
      existingWorkouts: [appleRow],
      inserts,
      updates,
    });

    const result = await syncStravaActivities(supabase as never, {
      userId: 'user-1',
      clientId: 'client',
      clientSecret: 'secret',
      options: { now: new Date('2026-05-16T00:00:00.000Z').getTime() },
    });

    expect(result).toMatchObject({
      activitiesFetched: 1,
      workoutsInserted: 0,
      workoutsLinkedToApple: 1,
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      source: 'strava',
      external_id: '999',
      superseded_by: 'apple-1',
      description: 'Strong climb on the last 5k',
    });
    // The Apple row should be updated with the Strava description.
    const descUpdate = updates.find(
      (u) => u.table === 'workouts' && u.id === 'apple-1' && u.values.description,
    );
    expect(descUpdate?.values.description).toBe('Strong climb on the last 5k');
  });

  it('is idempotent when the same Strava activity is synced twice', async () => {
    vi.stubGlobal(
      'fetch',
      mockStravaFetch([
        {
          id: 777,
          type: 'Run',
          sport_type: 'Run',
          description: 'Tempo day',
          start_date: '2026-05-15T13:00:00.000Z',
          moving_time: 3600,
        },
      ]),
    );

    const existingStrava: WorkoutRow = {
      id: 'strava-1',
      source: 'strava',
      external_id: '777',
      workout_type: 'Run',
      started_at: '2026-05-15T13:00:00.000Z',
      duration_seconds: 3600,
      description: 'Tempo day',
      superseded_by: null,
    };

    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ table: string; values: Record<string, unknown>; id?: string }> = [];
    const supabase = buildSupabase({
      integration: {
        id: 'integration-1',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expires_at: '2099-01-01T00:00:00.000Z',
        last_synced_at: '2026-05-15T00:00:00.000Z',
      },
      existingWorkouts: [existingStrava],
      inserts,
      updates,
    });

    const result = await syncStravaActivities(supabase as never, {
      userId: 'user-1',
      clientId: 'client',
      clientSecret: 'secret',
      options: { now: new Date('2026-05-16T00:00:00.000Z').getTime() },
    });

    expect(result).toMatchObject({
      activitiesFetched: 1,
      workoutsInserted: 0,
      workoutsLinkedToApple: 0,
      workoutsAlreadyPresent: 1,
    });
    expect(inserts).toHaveLength(0);
  });

  it('refreshes an expired token before fetching activities', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'fresh-access',
          refresh_token: 'fresh-refresh',
          expires_at: Math.floor(new Date('2099-06-01T00:00:00.000Z').getTime() / 1000),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });
    vi.stubGlobal('fetch', fetchMock);

    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ table: string; values: Record<string, unknown>; id?: string }> = [];
    const supabase = buildSupabase({
      integration: {
        id: 'integration-1',
        access_token: 'expired-access',
        refresh_token: 'stale-refresh',
        token_expires_at: '2026-05-01T00:00:00.000Z',
        last_synced_at: null,
      },
      existingWorkouts: [],
      inserts,
      updates,
    });

    const result = await syncStravaActivities(supabase as never, {
      userId: 'user-1',
      clientId: 'client',
      clientSecret: 'secret',
      options: { now: new Date('2026-05-16T00:00:00.000Z').getTime() },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.strava.com/oauth/token');
    expect(result.tokenRefreshed).toBe(true);
    // Token columns should have been updated.
    const tokenUpdate = updates.find(
      (u) => u.table === 'user_integrations' && 'access_token_encrypted' in u.values,
    );
    expect(tokenUpdate?.values.access_token_encrypted).toBe('fresh-access');
  });

  it('throws StravaSyncError when no integration row exists', async () => {
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      limit() {
                        return {
                          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
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
    };

    await expect(
      syncStravaActivities(supabase as never, {
        userId: 'user-1',
        clientId: 'client',
        clientSecret: 'secret',
      }),
    ).rejects.toBeInstanceOf(StravaSyncError);
  });
});
