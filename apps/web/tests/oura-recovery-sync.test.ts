import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeOuraRecoveryRows, syncOuraRecovery } from '../lib/oura/recovery-sync';

describe('normalizeOuraRecoveryRows', () => {
  it('merges readiness, sleep, and activity payloads into recovery_daily upsert rows', () => {
    const rows = normalizeOuraRecoveryRows({
      userId: 'user-123',
      readinessRecords: [
        {
          day: '2026-05-04',
          score: 86,
          temperature_deviation: 0.18,
          contributors: { previous_night: 90 },
        },
      ],
      sleepRecords: [
        {
          day: '2026-05-04',
          score: 82,
          total_sleep_duration: 27000,
          average_hrv: 44.7,
          lowest_heart_rate: 51,
          average_breath: 14.2,
        },
      ],
      activityRecords: [
        {
          day: '2026-05-04',
          score: 78,
          strain: 12.5,
        },
      ],
    });

    expect(rows).toEqual([
      {
        user_id: 'user-123',
        source: 'oura',
        day: '2026-05-04',
        readiness_score: 86,
        sleep_score: 82,
        activity_score: 78,
        sleep_duration_minutes: 450,
        hrv_ms: 44.7,
        resting_hr: 51,
        body_temperature_delta: 0.18,
        respiratory_rate: 14.2,
        strain_score: 12.5,
        flag: 'green',
        metadata: {
          oura: {
            readiness: {
              day: '2026-05-04',
              score: 86,
              temperature_deviation: 0.18,
              contributors: { previous_night: 90 },
            },
            sleep: {
              day: '2026-05-04',
              score: 82,
              total_sleep_duration: 27000,
              average_hrv: 44.7,
              lowest_heart_rate: 51,
              average_breath: 14.2,
            },
            activity: {
              day: '2026-05-04',
              score: 78,
              strain: 12.5,
            },
          },
        },
      },
    ]);
  });

  it('applies explainable defaults when only partial Oura records are available', () => {
    const rows = normalizeOuraRecoveryRows({
      userId: 'user-123',
      readinessRecords: [
        {
          day: '2026-05-05',
          score: 68,
        },
      ],
      sleepRecords: [],
      activityRecords: [],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        user_id: 'user-123',
        day: '2026-05-05',
        readiness_score: 68,
        sleep_score: null,
        activity_score: null,
        flag: 'red',
      }),
    ]);
  });
});

describe('syncOuraRecovery', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.OURA_CLIENT_ID = 'oura-client-id';
    process.env.OURA_CLIENT_SECRET = 'oura-client-secret';
  });

  it('fetches Oura daily collections, upserts recovery_daily rows, and updates last_synced_at idempotently', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ day: '2026-05-04', score: 86, temperature_deviation: 0.18 }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              day: '2026-05-04',
              score: 82,
              total_sleep_duration: 27000,
              average_hrv: 44.7,
              lowest_heart_rate: 51,
              average_breath: 14.2,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ day: '2026-05-04', score: 78, strain: 12.5 }],
        }),
      });

    const integrationState = {
      data: {
        id: 'integration-1',
        user_id: 'user-123',
        provider: 'oura',
        status: 'active',
        access_token_encrypted: 'access-token',
        refresh_token_encrypted: 'refresh-token',
        token_expires_at: '2099-05-01T00:00:00.000Z',
        last_synced_at: '2026-05-03T12:00:00.000Z',
      },
      error: null,
    };
    const recoveryUpsert = vi.fn().mockResolvedValue({ error: null });
    const integrationUpdate = vi.fn().mockResolvedValue({ error: null });
    const tableCalls: Array<{ table: string; rows?: unknown; values?: unknown }> = [];

    const supabase = {
      from(table: string) {
        if (table === 'user_integrations') {
          return {
            select() {
              return {
                eq(_column: string, _value: unknown) {
                  return {
                    eq(_statusColumn: string, _statusValue: unknown) {
                      return {
                        maybeSingle: vi.fn().mockResolvedValue(integrationState),
                      };
                    },
                  };
                },
              };
            },
            update(values: unknown) {
              tableCalls.push({ table, values });
              return {
                eq: integrationUpdate,
              };
            },
          };
        }

        if (table === 'recovery_daily') {
          return {
            upsert(rows: unknown, options: unknown) {
              tableCalls.push({ table, rows, values: options });
              return recoveryUpsert(rows, options);
            },
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    };

    const result = await syncOuraRecovery(supabase as never, {
      userId: 'user-123',
      endDate: '2026-05-06',
      fetchImpl: fetchMock as typeof fetch,
      now: new Date('2026-05-06T10:00:00.000Z'),
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=2026-05-02&end_date=2026-05-06',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=2026-05-02&end_date=2026-05-06',
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://api.ouraring.com/v2/usercollection/daily_activity?start_date=2026-05-02&end_date=2026-05-06',
    );
    expect(recoveryUpsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: 'user-123',
          source: 'oura',
          day: '2026-05-04',
          readiness_score: 86,
          sleep_score: 82,
          activity_score: 78,
        }),
      ],
      { onConflict: 'user_id,source,day' },
    );
    expect(integrationUpdate).toHaveBeenCalledWith('id', 'integration-1');
    expect(tableCalls).toContainEqual({
      table: 'user_integrations',
      values: expect.objectContaining({
        last_synced_at: '2026-05-06T10:00:00.000Z',
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      provider: 'oura',
      userId: 'user-123',
      startDate: '2026-05-02',
      endDate: '2026-05-06',
      syncedDays: 1,
      tokenRefreshed: false,
      recordsFetched: {
        readiness: 1,
        sleep: 1,
        activity: 1,
      },
    });
  });

  it('refreshes an expired token before fetching Oura data', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'fresh-access-token',
          refresh_token: 'fresh-refresh-token',
          expires_in: 7200,
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });

    const recoveryUpsert = vi.fn().mockResolvedValue({ error: null });
    const integrationUpdate = vi.fn().mockResolvedValue({ error: null });

    const supabase = {
      from(table: string) {
        if (table === 'user_integrations') {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: {
                            id: 'integration-1',
                            user_id: 'user-123',
                            provider: 'oura',
                            status: 'active',
                            access_token_encrypted: 'expired-access-token',
                            refresh_token_encrypted: 'stale-refresh-token',
                            token_expires_at: '2026-05-01T00:00:00.000Z',
                            last_synced_at: null,
                          },
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
            update() {
              return {
                eq: integrationUpdate,
              };
            },
          };
        }

        if (table === 'recovery_daily') {
          return {
            upsert: recoveryUpsert,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    };

    const result = await syncOuraRecovery(supabase as never, {
      userId: 'user-123',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      fetchImpl: fetchMock as typeof fetch,
      now: new Date('2026-05-02T09:30:00.000Z'),
    });

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.ouraring.com/oauth/token');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: {
        authorization: 'Bearer fresh-access-token',
      },
    });
    expect(integrationUpdate).toHaveBeenCalledWith('id', 'integration-1');
    expect(result).toMatchObject({
      ok: true,
      tokenRefreshed: true,
      syncedDays: 0,
    });
  });
});
