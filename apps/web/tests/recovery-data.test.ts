import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuthenticatedUser } = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }));
const { createServerSupabaseClient } = vi.hoisted(() => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUser }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));

import {
  loadRecoveryPageState,
  mapRecoveryRows,
  summarizeBaseline,
} from '../app/recovery/recovery-data';

type Row = {
  day: string;
  readiness_score: number | null;
  sleep_score: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  flag: 'green' | 'yellow' | 'red' | null;
};

// Thenable stub for select(...).eq().gte().lte().order().
function makeSupabase(result: { data: Row[] | null; error: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lte', 'order']) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return { from: () => q };
}

const row = (p: Partial<Row> & { day: string }): Row => ({
  readiness_score: null,
  sleep_score: null,
  hrv_ms: null,
  resting_hr: null,
  flag: null,
  ...p,
});

describe('summarizeBaseline', () => {
  it('averages non-null values and counts days with data', () => {
    const b = summarizeBaseline(
      mapRecoveryRows([
        row({ day: '2026-06-01', readiness_score: 84, hrv_ms: 132, resting_hr: 41, sleep_score: 81 }),
        row({ day: '2026-05-31', readiness_score: 66, hrv_ms: 43, resting_hr: 49, sleep_score: 73 }),
        row({ day: '2026-05-30', readiness_score: 44, hrv_ms: 44, resting_hr: 58, sleep_score: 57 }),
        row({ day: '2026-05-29' }), // all null — ignored in averages, not counted
      ]),
    );
    expect(b.avgReadiness).toBe(64.7); // (84+66+44)/3
    expect(b.avgHrv).toBe(73); // (132+43+44)/3
    expect(b.daysWithData).toBe(3);
  });

  it('returns null averages when nothing has data', () => {
    const b = summarizeBaseline(mapRecoveryRows([row({ day: '2026-05-29' })]));
    expect(b).toMatchObject({ avgReadiness: null, avgHrv: null, daysWithData: 0 });
  });
});

describe('loadRecoveryPageState', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns unauthenticated when no user', async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    expect(await loadRecoveryPageState()).toEqual({ kind: 'unauthenticated' });
  });

  it('builds latest snapshot, baseline, and improving trend from desc rows', async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1', email: 'a@b.co' });
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        data: [
          row({ day: '2026-06-01', readiness_score: 84, hrv_ms: 132, resting_hr: 41, sleep_score: 81, flag: 'yellow' }),
          row({ day: '2026-05-31', readiness_score: 66, hrv_ms: 43, resting_hr: 49, sleep_score: 73, flag: 'red' }),
          row({ day: '2026-05-30', readiness_score: 44, hrv_ms: 44, resting_hr: 58, sleep_score: 57, flag: 'red' }),
        ],
        error: null,
      }),
    );

    const state = await loadRecoveryPageState({ today: '2026-06-01' });
    if (state.kind !== 'ready') throw new Error('expected ready');

    expect(state.days).toHaveLength(3);
    expect(state.latest?.day).toBe('2026-06-01');
    expect(state.latest?.hrvMs).toBe(132);
    expect(state.baseline.avgReadiness).toBe(64.7);
    // readiness ascending 44 -> 66 -> 84 over the window
    expect(state.trend.direction).toBe('improving');
    expect(state.trend.sampleCount).toBe(3);
  });

  it('latest skips a most-recent row that has no data', async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1' });
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        data: [
          row({ day: '2026-06-01' }), // no data (ring not worn)
          row({ day: '2026-05-31', readiness_score: 70, hrv_ms: 60 }),
        ],
        error: null,
      }),
    );
    const state = await loadRecoveryPageState({ today: '2026-06-01' });
    if (state.kind !== 'ready') throw new Error('expected ready');
    expect(state.latest?.day).toBe('2026-05-31');
  });

  it('handles empty history (ready with zeroed baseline and no trend)', async () => {
    getAuthenticatedUser.mockResolvedValue({ id: 'user-1' });
    createServerSupabaseClient.mockReturnValue(makeSupabase({ data: [], error: null }));
    const state = await loadRecoveryPageState({ today: '2026-06-01' });
    if (state.kind !== 'ready') throw new Error('expected ready');
    expect(state.days).toEqual([]);
    expect(state.latest).toBeNull();
    expect(state.baseline.daysWithData).toBe(0);
    expect(state.trend.sampleCount).toBe(0);
  });
});
