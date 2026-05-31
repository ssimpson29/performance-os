import { requireOuraEnv } from '@/lib/env';

type SupabaseLike = {
  from: (table: string) => any;
};

type OuraRecord = Record<string, unknown> & {
  day?: string;
  score?: number;
};

type IntegrationRecord = {
  id: string;
  user_id: string;
  provider: 'oura';
  status: 'active';
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
};

type NormalizeOuraRecoveryRowsInput = {
  userId: string;
  readinessRecords: OuraRecord[];
  /** daily_sleep documents — score + contributors only. */
  sleepRecords: OuraRecord[];
  activityRecords: OuraRecord[];
  /**
   * Detailed sleep-period documents (/usercollection/sleep). The only source
   * of raw average_hrv (ms), lowest_heart_rate (bpm), total_sleep_duration
   * (s), and average_breath. Multiple per day (naps + main sleep); the main
   * sleep is the longest period. Optional for back-compat with callers/tests
   * that don't pass it (those rows just keep null HRV/HR, as before).
   */
  detailedSleepRecords?: OuraRecord[];
};

type RecoveryFlag = 'green' | 'yellow' | 'red';

type RecoveryDailyRow = {
  user_id: string;
  source: 'oura';
  day: string;
  readiness_score: number | null;
  sleep_score: number | null;
  activity_score: number | null;
  sleep_duration_minutes: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  body_temperature_delta: number | null;
  respiratory_rate: number | null;
  strain_score: number | null;
  flag: RecoveryFlag | null;
  metadata: {
    oura: {
      readiness: OuraRecord | null;
      sleep: OuraRecord | null;
      activity: OuraRecord | null;
      detailedSleep?: OuraRecord | null;
    };
  };
};

type SyncOuraRecoveryParams = {
  userId: string;
  startDate?: string;
  endDate?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export class OuraRecoverySyncError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OuraRecoverySyncError';
  }
}

const OURA_API_BASE = 'https://api.ouraring.com';
const DEFAULT_BACKFILL_DAYS = 30;
const OVERLAP_DAYS = 1;

function isIsoDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function asDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, delta: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return asDay(date);
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integerOrNull(value: unknown) {
  const numeric = numberOrNull(value);
  return numeric === null ? null : Math.round(numeric);
}

function minutesFromSeconds(value: unknown) {
  const numeric = numberOrNull(value);
  return numeric === null ? null : Math.round(numeric / 60);
}

function deriveRecoveryFlag(score: number | null): RecoveryFlag | null {
  if (score === null) return null;
  if (score >= 85) return 'green';
  if (score >= 70) return 'yellow';
  return 'red';
}

function getBodyTemperatureDelta(readiness: OuraRecord | null, sleep: OuraRecord | null) {
  return (
    numberOrNull(readiness?.temperature_deviation) ??
    numberOrNull(readiness?.body_temperature_delta) ??
    numberOrNull(sleep?.temperature_deviation) ??
    numberOrNull(sleep?.body_temperature_delta)
  );
}

function getRespiratoryRate(sleep: OuraRecord | null) {
  return numberOrNull(sleep?.average_breath) ?? numberOrNull(sleep?.respiratory_rate);
}

function getHrv(sleep: OuraRecord | null, readiness: OuraRecord | null) {
  return numberOrNull(sleep?.average_hrv) ?? numberOrNull(readiness?.average_hrv) ?? numberOrNull(readiness?.hrv_ms);
}

function getRestingHr(sleep: OuraRecord | null, readiness: OuraRecord | null) {
  return (
    numberOrNull(sleep?.lowest_heart_rate) ??
    numberOrNull(sleep?.resting_heart_rate) ??
    numberOrNull(readiness?.resting_heart_rate)
  );
}

function getStrainScore(activity: OuraRecord | null) {
  return numberOrNull(activity?.strain) ?? numberOrNull(activity?.strain_score) ?? null;
}

export function normalizeOuraRecoveryRows({
  userId,
  readinessRecords,
  sleepRecords,
  activityRecords,
  detailedSleepRecords = [],
}: NormalizeOuraRecoveryRowsInput): RecoveryDailyRow[] {
  const byDay = new Map<
    string,
    {
      readiness: OuraRecord | null;
      sleep: OuraRecord | null;
      activity: OuraRecord | null;
      detailedSleep: OuraRecord | null;
    }
  >();

  const emptyEntry = () => ({ readiness: null, sleep: null, activity: null, detailedSleep: null });

  const ingest = (type: 'readiness' | 'sleep' | 'activity', records: OuraRecord[]) => {
    for (const record of records) {
      if (!record.day || !isIsoDay(record.day)) continue;
      const current = byDay.get(record.day) ?? emptyEntry();
      current[type] = record;
      byDay.set(record.day, current);
    }
  };

  // Detailed sleep can have several periods per day (main sleep + naps). Keep
  // the longest as the night's main sleep — that's what carries the
  // representative HRV / resting HR / duration. Skip deleted documents.
  const ingestDetailedSleep = (records: OuraRecord[]) => {
    for (const record of records) {
      if (!record.day || !isIsoDay(record.day)) continue;
      if (record.type === 'deleted') continue;
      const current = byDay.get(record.day) ?? emptyEntry();
      const incoming = numberOrNull(record.total_sleep_duration) ?? 0;
      const existing = numberOrNull(current.detailedSleep?.total_sleep_duration) ?? -1;
      if (!current.detailedSleep || incoming > existing) {
        current.detailedSleep = record;
      }
      byDay.set(record.day, current);
    }
  };

  ingest('readiness', readinessRecords);
  ingest('sleep', sleepRecords);
  ingest('activity', activityRecords);
  ingestDetailedSleep(detailedSleepRecords);

  return [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, records]) => {
      const readinessScore = integerOrNull(records.readiness?.score);
      const sleepScore = integerOrNull(records.sleep?.score);
      const activityScore = integerOrNull(records.activity?.score);

      // Raw physiological values live on the detailed sleep period, not on
      // daily_sleep. Prefer it; fall back to the legacy daily_sleep/readiness
      // lookups so nothing regresses when detailed sleep is absent.
      const sleepForVitals = records.detailedSleep ?? records.sleep;

      return {
        user_id: userId,
        source: 'oura',
        day,
        readiness_score: readinessScore,
        sleep_score: sleepScore,
        activity_score: activityScore,
        sleep_duration_minutes: minutesFromSeconds(
          records.detailedSleep?.total_sleep_duration ?? records.sleep?.total_sleep_duration,
        ),
        hrv_ms: getHrv(sleepForVitals, records.readiness),
        resting_hr: getRestingHr(sleepForVitals, records.readiness),
        body_temperature_delta: getBodyTemperatureDelta(records.readiness, sleepForVitals),
        respiratory_rate: getRespiratoryRate(sleepForVitals),
        strain_score: getStrainScore(records.activity),
        flag: deriveRecoveryFlag(readinessScore ?? sleepScore),
        metadata: {
          oura: {
            readiness: records.readiness,
            sleep: records.sleep,
            activity: records.activity,
            detailedSleep: records.detailedSleep,
          },
        },
      };
    });
}

function resolveDateRange({
  startDate,
  endDate,
  lastSyncedAt,
  now,
}: {
  startDate?: string;
  endDate?: string;
  lastSyncedAt: string | null;
  now: Date;
}) {
  const resolvedEndDate = endDate ?? asDay(now);

  if (!isIsoDay(resolvedEndDate)) {
    throw new OuraRecoverySyncError('Invalid endDate. Use YYYY-MM-DD.', 400);
  }

  const derivedStartDate = startDate
    ? startDate
    : lastSyncedAt
      ? addDays(asDay(new Date(lastSyncedAt)), -OVERLAP_DAYS)
      : addDays(resolvedEndDate, -(DEFAULT_BACKFILL_DAYS - 1));

  if (!isIsoDay(derivedStartDate)) {
    throw new OuraRecoverySyncError('Invalid startDate. Use YYYY-MM-DD.', 400);
  }

  if (derivedStartDate > resolvedEndDate) {
    throw new OuraRecoverySyncError('startDate must be on or before endDate.', 400);
  }

  return {
    startDate: derivedStartDate,
    endDate: resolvedEndDate,
  };
}

async function refreshOuraAccessToken(
  fetchImpl: typeof fetch,
  refreshToken: string,
  now: Date,
): Promise<{ accessToken: string; refreshToken: string | null; tokenExpiresAt: string | null }> {
  const { appUrl, ouraClientId, ouraClientSecret } = requireOuraEnv();
  const redirectUri = `${appUrl.replace(/\/$/, '')}/api/imports/oura/callback`;
  const response = await fetchImpl(`${OURA_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: ouraClientId,
      client_secret: ouraClientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  });

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new OuraRecoverySyncError(payload.error ?? 'Failed to refresh Oura token.', 502);
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    tokenExpiresAt:
      typeof payload.expires_in === 'number' ? new Date(now.getTime() + payload.expires_in * 1000).toISOString() : null,
  };
}

async function fetchOuraCollection(
  fetchImpl: typeof fetch,
  // 'sleep' is the detailed sleep-period collection — the ONLY source of raw
  // average_hrv / lowest_heart_rate / total_sleep_duration / average_breath.
  // 'daily_sleep' carries only the 0-100 score + contributors.
  collection: 'daily_readiness' | 'daily_sleep' | 'daily_activity' | 'sleep',
  accessToken: string,
  startDate: string,
  endDate: string,
) {
  const records: OuraRecord[] = [];
  let nextToken: string | null = null;

  do {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
    });

    if (nextToken) {
      params.set('next_token', nextToken);
    }

    const response = await fetchImpl(`${OURA_API_BASE}/v2/usercollection/${collection}?${params.toString()}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    const payload = (await response.json()) as {
      data?: OuraRecord[];
      next_token?: string | null;
      message?: string;
      error?: string;
    };

    if (!response.ok) {
      throw new OuraRecoverySyncError(payload.message ?? payload.error ?? `Failed to fetch Oura ${collection}.`, 502);
    }

    records.push(...(Array.isArray(payload.data) ? payload.data : []));
    nextToken = payload.next_token ?? null;
  } while (nextToken);

  return records;
}

function accessTokenNeedsRefresh(integration: IntegrationRecord, now: Date) {
  if (!integration.token_expires_at) return false;
  return new Date(integration.token_expires_at).getTime() <= now.getTime() + 60_000;
}

async function loadActiveIntegration(supabase: SupabaseLike, userId: string) {
  const query = supabase
    .from('user_integrations')
    .select?.('id, user_id, provider, status, access_token_encrypted, refresh_token_encrypted, token_expires_at, last_synced_at')
    .eq('user_id', userId)
    .eq('provider', 'oura');

  const result = await query.maybeSingle();
  const integration = (result?.data ?? null) as IntegrationRecord | null;

  if (result?.error) {
    throw new OuraRecoverySyncError(result.error.message, 500);
  }

  if (!integration || integration.status !== 'active') {
    throw new OuraRecoverySyncError('No active Oura integration found for user.', 404);
  }

  return integration;
}

async function persistIntegrationTokens(
  supabase: SupabaseLike,
  integrationId: string,
  values: Record<string, unknown>,
) {
  const result = await supabase.from('user_integrations').update?.(values).eq('id', integrationId);

  if (result?.error) {
    throw new OuraRecoverySyncError(result.error.message, 500);
  }
}

export async function syncOuraRecovery(
  supabase: SupabaseLike,
  { userId, startDate, endDate, fetchImpl = fetch, now = new Date() }: SyncOuraRecoveryParams,
) {
  const integration = await loadActiveIntegration(supabase, userId);

  let accessToken = integration.access_token_encrypted;
  let tokenRefreshed = false;

  if (!accessToken) {
    throw new OuraRecoverySyncError('Oura integration is missing an access token.', 409);
  }

  if (accessTokenNeedsRefresh(integration, now)) {
    if (!integration.refresh_token_encrypted) {
      throw new OuraRecoverySyncError('Oura integration requires re-authentication.', 409);
    }

    const refreshed = await refreshOuraAccessToken(fetchImpl, integration.refresh_token_encrypted, now);
    accessToken = refreshed.accessToken;
    tokenRefreshed = true;

    await persistIntegrationTokens(supabase, integration.id, {
      access_token_encrypted: refreshed.accessToken,
      refresh_token_encrypted: refreshed.refreshToken,
      token_expires_at: refreshed.tokenExpiresAt,
    });
  }

  const range = resolveDateRange({
    startDate,
    endDate,
    lastSyncedAt: integration.last_synced_at,
    now,
  });

  const [readinessRecords, sleepRecords, activityRecords, detailedSleepRecords] = await Promise.all([
    fetchOuraCollection(fetchImpl, 'daily_readiness', accessToken, range.startDate, range.endDate),
    fetchOuraCollection(fetchImpl, 'daily_sleep', accessToken, range.startDate, range.endDate),
    fetchOuraCollection(fetchImpl, 'daily_activity', accessToken, range.startDate, range.endDate),
    fetchOuraCollection(fetchImpl, 'sleep', accessToken, range.startDate, range.endDate),
  ]);

  const rows = normalizeOuraRecoveryRows({
    userId,
    readinessRecords,
    sleepRecords,
    activityRecords,
    detailedSleepRecords,
  });

  if (rows.length > 0) {
    const result = await supabase.from('recovery_daily').upsert?.(rows, {
      onConflict: 'user_id,source,day',
    });

    if (result?.error) {
      throw new OuraRecoverySyncError(result.error.message, 500);
    }
  }

  await persistIntegrationTokens(supabase, integration.id, {
    last_synced_at: now.toISOString(),
  });

  return {
    ok: true,
    provider: 'oura' as const,
    userId,
    startDate: range.startDate,
    endDate: range.endDate,
    syncedDays: rows.length,
    recordsFetched: {
      readiness: readinessRecords.length,
      sleep: sleepRecords.length,
      activity: activityRecords.length,
    },
    tokenRefreshed,
  };
}
