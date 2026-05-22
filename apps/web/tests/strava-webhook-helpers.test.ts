import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleStravaActivityEvent,
  loadStravaIntegrationByOwnerId,
  processStravaActivity,
  type WorkoutRow,
} from '../lib/strava/activity-sync';

/**
 * Phase 4 webhook helpers. The batch-sync coverage lives in
 * strava-activity-sync.test.ts; this file targets the new code paths that
 * are unique to the webhook:
 *   - processStravaActivity: pure per-activity logic, all three result
 *     branches (inserted / linked / alreadyPresent).
 *   - loadStravaIntegrationByOwnerId: resolves Strava athlete id → user id.
 *   - handleStravaActivityEvent: fetches the single activity from Strava
 *     and delegates to processStravaActivity (token refresh path is
 *     exercised in strava-activity-sync.test.ts).
 */

describe('processStravaActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "inserted" when no canonical workout exists for the same session', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const supabase = {
      from() {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
    };

    const result = await processStravaActivity(supabase as never, {
      userId: 'user-1',
      activity: {
        id: 'strava-555',
        type: 'Run',
        sport_type: 'Run',
        description: 'Solo loop',
        start_date: '2026-05-15T13:00:00.000Z',
        moving_time: 3600,
      },
      existing: [],
    });

    expect(result).toBe('inserted');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      source: 'strava',
      external_id: 'strava-555',
      superseded_by: null,
      description: 'Solo loop',
    });
  });

  it('returns "linked" when an Apple-sourced workout matches, and forwards the description', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
    const supabase = {
      from() {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push(row);
            return Promise.resolve({ error: null });
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

    const appleRow: WorkoutRow = {
      id: 'apple-1',
      source: 'apple_watch',
      external_id: 'apple-ext-1',
      workout_type: 'Outdoor Run',
      started_at: '2026-05-15T13:00:00.000Z',
      duration_seconds: 3600,
      description: null,
      superseded_by: null,
    };

    const result = await processStravaActivity(supabase as never, {
      userId: 'user-1',
      activity: {
        id: 'strava-999',
        type: 'Run',
        sport_type: 'TrailRun',
        description: 'Tough climb',
        start_date: '2026-05-15T13:00:30.000Z',
        moving_time: 3620,
      },
      existing: [appleRow],
    });

    expect(result).toBe('linked');
    expect(inserts[0]).toMatchObject({
      source: 'strava',
      superseded_by: 'apple-1',
      description: 'Tough climb',
    });
    // Description forwarded onto the Apple row because Apple row had no description.
    expect(updates).toContainEqual({
      id: 'apple-1',
      values: { description: 'Tough climb' },
    });
  });

  it('returns "alreadyPresent" when the same Strava external_id is already saved', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const supabase = {
      from() {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
    };

    const existingStrava: WorkoutRow = {
      id: 'strava-row-1',
      source: 'strava',
      external_id: 'strava-777',
      workout_type: 'Run',
      started_at: '2026-05-15T13:00:00.000Z',
      duration_seconds: 3600,
      description: 'Already there',
      superseded_by: null,
    };

    const result = await processStravaActivity(supabase as never, {
      userId: 'user-1',
      activity: {
        id: 'strava-777',
        type: 'Run',
        sport_type: 'Run',
        start_date: '2026-05-15T13:00:00.000Z',
        moving_time: 3600,
      },
      existing: [existingStrava],
    });

    expect(result).toBe('alreadyPresent');
    expect(inserts).toHaveLength(0);
  });
});

describe('loadStravaIntegrationByOwnerId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the user id and integration row for a known Strava athlete', async () => {
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
                          maybeSingle: vi.fn().mockResolvedValue({
                            data: {
                              id: 'integration-1',
                              user_id: 'user-1',
                              access_token_encrypted: 'access',
                              refresh_token_encrypted: 'refresh',
                              token_expires_at: '2099-01-01T00:00:00.000Z',
                              external_user_id: '42',
                              last_synced_at: null,
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
        };
      },
    };

    const result = await loadStravaIntegrationByOwnerId(supabase as never, 42);
    expect(result).not.toBeNull();
    expect(result?.userId).toBe('user-1');
    expect(result?.integration.id).toBe('integration-1');
  });

  it('returns null when no row maps to the owner id', async () => {
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

    const result = await loadStravaIntegrationByOwnerId(supabase as never, 'unknown-owner');
    expect(result).toBeNull();
  });
});

describe('handleStravaActivityEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the single activity, queries the ±5min window, and delegates to processStravaActivity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'strava-event-1',
          type: 'Run',
          sport_type: 'Run',
          description: 'Webhook activity',
          start_date: '2026-05-15T13:00:00.000Z',
          moving_time: 3600,
        }),
      }),
    );

    const inserts: Array<Record<string, unknown>> = [];
    const supabase = {
      from(table: string) {
        if (table === 'workouts') {
          return {
            select() {
              return {
                eq() {
                  return {
                    gte() {
                      return {
                        lte: vi.fn().mockResolvedValue({ data: [], error: null }),
                      };
                    },
                  };
                },
              };
            },
            insert(row: Record<string, unknown>) {
              inserts.push(row);
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    const result = await handleStravaActivityEvent(supabase as never, {
      userId: 'user-1',
      integration: {
        id: 'integration-1',
        access_token_encrypted: 'access',
        refresh_token_encrypted: 'refresh',
        token_expires_at: '2099-01-01T00:00:00.000Z',
        external_user_id: '42',
        last_synced_at: null,
        metadata: null,
      },
      activityId: 'strava-event-1',
      clientId: 'client',
      clientSecret: 'secret',
      now: new Date('2026-05-16T00:00:00.000Z').getTime(),
    });

    expect(result).toBe('inserted');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ external_id: 'strava-event-1' });
  });

  it('returns "notFound" when Strava 404s the activity (e.g. deleted before we could fetch)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      }),
    );

    const supabase = {
      from() {
        throw new Error('should not query DB on 404');
      },
    };

    const result = await handleStravaActivityEvent(supabase as never, {
      userId: 'user-1',
      integration: {
        id: 'integration-1',
        access_token_encrypted: 'access',
        refresh_token_encrypted: 'refresh',
        token_expires_at: '2099-01-01T00:00:00.000Z',
        external_user_id: '42',
        last_synced_at: null,
        metadata: null,
      },
      activityId: 'strava-event-deleted',
      clientId: 'client',
      clientSecret: 'secret',
      now: new Date('2026-05-16T00:00:00.000Z').getTime(),
    });

    expect(result).toBe('notFound');
  });
});
