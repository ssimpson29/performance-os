import type { SupabaseClient } from '@supabase/supabase-js';

import { getAuthenticatedUser } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { computeRecoveryTrend } from '@/lib/training-plan/adaptive-coach';
import type { RecoveryTrend } from '@/lib/training-plan/types';

const DEFAULT_LOOKBACK_DAYS = 30;

export type RecoveryFlag = 'green' | 'yellow' | 'red' | null;

export type RecoveryDay = {
  day: string;
  readinessScore: number | null;
  sleepScore: number | null;
  hrvMs: number | null;
  restingHr: number | null;
  flag: RecoveryFlag;
};

export type RecoveryBaseline = {
  avgReadiness: number | null;
  avgSleep: number | null;
  avgHrv: number | null;
  avgRestingHr: number | null;
  /** Days in the window carrying at least a readiness score or HRV value. */
  daysWithData: number;
};

export type RecoveryPageState =
  | { kind: 'unauthenticated' }
  | {
      kind: 'ready';
      today: string;
      lookbackDays: number;
      /** Most recent day that has data (not necessarily today). */
      latest: RecoveryDay | null;
      /** Window rows, most-recent-first. */
      days: RecoveryDay[];
      baseline: RecoveryBaseline;
      trend: RecoveryTrend;
    };

type RecoveryRow = {
  day: string;
  readiness_score: number | null;
  sleep_score: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  flag: RecoveryFlag;
};

function isoDateAddDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number');
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

export function mapRecoveryRows(rows: RecoveryRow[]): RecoveryDay[] {
  return rows.map((r) => ({
    day: r.day,
    readinessScore: r.readiness_score,
    sleepScore: r.sleep_score,
    hrvMs: r.hrv_ms,
    restingHr: r.resting_hr,
    flag: r.flag,
  }));
}

export function summarizeBaseline(days: RecoveryDay[]): RecoveryBaseline {
  return {
    avgReadiness: avg(days.map((d) => d.readinessScore)),
    avgSleep: avg(days.map((d) => d.sleepScore)),
    avgHrv: avg(days.map((d) => d.hrvMs)),
    avgRestingHr: avg(days.map((d) => d.restingHr)),
    daysWithData: days.filter((d) => d.readinessScore != null || d.hrvMs != null).length,
  };
}

export async function loadRecoveryPageState(args?: {
  today?: string;
  lookbackDays?: number;
}): Promise<RecoveryPageState> {
  const user = await getAuthenticatedUser();
  if (!user) return { kind: 'unauthenticated' };

  const supabase: SupabaseClient = createServerSupabaseClient();
  const today = args?.today ?? new Date().toISOString().slice(0, 10);
  const lookbackDays = args?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const since = isoDateAddDays(today, -lookbackDays);

  const { data, error } = await supabase
    .from('recovery_daily')
    .select('day, readiness_score, sleep_score, hrv_ms, resting_hr, flag')
    .eq('user_id', user.id)
    .gte('day', since)
    .lte('day', today)
    .order('day', { ascending: false });

  const rows = error ? [] : ((data as RecoveryRow[] | null) ?? []);
  const days = mapRecoveryRows(rows); // most-recent-first
  const latest = days.find((d) => d.readinessScore != null || d.hrvMs != null) ?? days[0] ?? null;
  const baseline = summarizeBaseline(days);

  // Trend reads readiness as the score, oldest -> newest.
  const samples = [...days]
    .reverse()
    .filter((d) => d.readinessScore != null)
    .map((d) => ({ date: d.day, score: d.readinessScore as number }));
  const trend = computeRecoveryTrend(samples);

  return { kind: 'ready', today, lookbackDays, latest, days, baseline, trend };
}
