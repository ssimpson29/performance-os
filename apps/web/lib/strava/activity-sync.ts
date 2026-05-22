import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingMatch, type WorkoutLike } from '@/lib/workouts/duplicate-matching';

/**
 * Strava activity → Performance OS workout sync. Mirrors the Oura recovery
 * sync shape: load integration tokens, refresh if expired, fetch recent
 * activities, normalize, run the duplicate matcher against existing
 * workouts, insert/link via the workouts table.
 *
 * Source precedence (per docs/plans/2026-05-22-strava-integration.md):
 *   - Apple metrics win for HR/distance/duration.
 *   - Strava description wins for athlete notes.
 *   - Both rows persist; the Strava row marks `superseded_by` when an
 *     Apple-sourced match exists, and the Apple row's `description` is
 *     filled in from the Strava activity.
 */

const STRAVA_OAUTH_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';

export class StravaSyncError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type IntegrationRow = {
  id: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  external_user_id: string | null;
  last_synced_at: string | null;
  metadata: Record<string, unknown> | null;
};

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

type StravaActivity = {
  id: number | string;
  name?: string;
  description?: string | null;
  type?: string;
  sport_type?: string;
  distance?: number;        // meters
  moving_time?: number;     // seconds
  elapsed_time?: number;    // seconds
  start_date?: string;      // ISO
  start_date_local?: string;
  average_heartrate?: number;
  max_heartrate?: number;
  total_elevation_gain?: number;
  kilojoules?: number;
};

export type SyncStravaOptions = {
  /** ISO date; defaults to 30 days ago. */
  afterDate?: string;
  /** Override token refresh check (testing). */
  now?: number;
};

export type StravaSyncResult = {
  ok: true;
  provider: 'strava';
  activitiesFetched: number;
  workoutsInserted: number;
  workoutsLinkedToApple: number;
  workoutsAlreadyPresent: number;
  tokenRefreshed: boolean;
};

async function refreshStravaToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string; expires_at: number }> {
  const res = await fetch(STRAVA_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new StravaSyncError(`Strava token refresh failed (${res.status}): ${text.slice(0, 200)}`, 502);
  }
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_at?: number };
  if (!data.access_token || !data.refresh_token || !data.expires_at) {
    throw new StravaSyncError('Strava token refresh response missing fields', 502);
  }
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at };
}

async function fetchActivities(accessToken: string, afterUnix: number): Promise<StravaActivity[]> {
  const url = new URL(STRAVA_ACTIVITIES_URL);
  url.searchParams.set('after', String(afterUnix));
  url.searchParams.set('per_page', '200');
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new StravaSyncError(`Strava activities fetch failed (${res.status}): ${text.slice(0, 200)}`, 502);
  }
  return (await res.json()) as StravaActivity[];
}

function activityToCandidate(activity: StravaActivity): WorkoutLike & {
  externalId: string;
  description: string | null;
  distanceMeters: number | null;
  avgHr: number | null;
  maxHr: number | null;
  elevationGainM: number | null;
  energyKcal: number | null;
  localDate: string;
  endedAt: string | null;
} {
  const startedAt = activity.start_date ?? new Date().toISOString();
  const localDate = (activity.start_date_local ?? startedAt).slice(0, 10);
  const duration = activity.moving_time ?? activity.elapsed_time ?? null;
  const endedAt = duration && activity.start_date ? new Date(new Date(activity.start_date).getTime() + duration * 1000).toISOString() : null;
  return {
    externalId: String(activity.id),
    workoutType: activity.sport_type ?? activity.type ?? 'Workout',
    startedAt,
    durationSeconds: duration,
    description: activity.description ?? null,
    distanceMeters: activity.distance ?? null,
    avgHr: activity.average_heartrate ?? null,
    maxHr: activity.max_heartrate ?? null,
    elevationGainM: activity.total_elevation_gain ?? null,
    energyKcal: activity.kilojoules != null ? Math.round(activity.kilojoules) : null,
    localDate,
    endedAt,
    source: 'strava',
  };
}

/**
 * Run a sync for the given athlete. Caller is responsible for auth-scoping
 * (the route handler resolves the userId from getAuthenticatedUserId).
 */
export async function syncStravaActivities(
  supabase: SupabaseClient,
  args: {
    userId: string;
    clientId: string;
    clientSecret: string;
    options?: SyncStravaOptions;
  },
): Promise<StravaSyncResult> {
  const { userId, clientId, clientSecret, options = {} } = args;
  const now = options.now ?? Date.now();

  // Load Strava integration row.
  const { data: integration, error: intError } = await supabase
    .from('user_integrations')
    .select('id, access_token_encrypted, refresh_token_encrypted, token_expires_at, external_user_id, last_synced_at, metadata')
    .eq('user_id', userId)
    .eq('provider', 'strava')
    .limit(1)
    .maybeSingle();
  if (intError) throw new StravaSyncError(`Failed to load Strava integration: ${intError.message}`, 500);
  if (!integration) throw new StravaSyncError('No Strava integration on record; connect Strava first.', 400);

  const row = integration as IntegrationRow;
  if (!row.access_token_encrypted || !row.refresh_token_encrypted) {
    throw new StravaSyncError('Strava integration is missing tokens; reconnect Strava.', 400);
  }

  // Refresh if expired (or within 60s of expiry).
  let accessToken = row.access_token_encrypted;
  let tokenRefreshed = false;
  const expiresAtMs = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  if (!expiresAtMs || expiresAtMs - now < 60_000) {
    const refreshed = await refreshStravaToken(clientId, clientSecret, row.refresh_token_encrypted);
    accessToken = refreshed.access_token;
    tokenRefreshed = true;
    await supabase
      .from('user_integrations')
      .update({
        access_token_encrypted: refreshed.access_token,
        refresh_token_encrypted: refreshed.refresh_token,
        token_expires_at: new Date(refreshed.expires_at * 1000).toISOString(),
      })
      .eq('id', row.id);
  }

  // Determine the "after" timestamp: caller override, last_synced_at, or 30 days ago.
  const fallbackAfter = Math.floor((now - 30 * 24 * 60 * 60 * 1000) / 1000);
  const afterUnix = options.afterDate
    ? Math.floor(new Date(options.afterDate).getTime() / 1000)
    : row.last_synced_at
      ? Math.floor(new Date(row.last_synced_at).getTime() / 1000)
      : fallbackAfter;

  const activities = await fetchActivities(accessToken, afterUnix);

  // Pull existing workouts in the window so we can match for duplicates.
  // Pad the window by 5 minutes on either side to catch boundary cases.
  const fromIso = new Date((afterUnix - 5 * 60) * 1000).toISOString();
  const { data: existingRows, error: exError } = await supabase
    .from('workouts')
    .select('id, source, external_id, workout_type, started_at, duration_seconds, description, superseded_by')
    .eq('user_id', userId)
    .gte('started_at', fromIso);
  if (exError) throw new StravaSyncError(`Failed to load workouts for matching: ${exError.message}`, 500);

  const existing: WorkoutRow[] = (existingRows as WorkoutRow[] | null) ?? [];
  // Adapt to WorkoutLike for matcher.
  const matcherInput = existing.map((w) => ({
    id: w.id,
    source: w.source,
    startedAt: w.started_at,
    durationSeconds: w.duration_seconds,
    workoutType: w.workout_type,
  }));

  let inserted = 0;
  let linked = 0;
  let alreadyPresent = 0;

  for (const activity of activities) {
    const candidate = activityToCandidate(activity);

    // Already-seen Strava activity? Upsert via (source, external_id) — no link needed.
    const sameSource = existing.find((w) => w.source === 'strava' && w.external_id === candidate.externalId);
    if (sameSource) {
      alreadyPresent += 1;
      continue;
    }

    // Search for an Apple-sourced match.
    const matched = findExistingMatch(candidate, matcherInput);
    const matchedAppleRow =
      matched && (matched.source === 'apple_health' || matched.source === 'apple_watch')
        ? existing.find((w) => w.id === matched.id) ?? null
        : null;

    const supersededBy = matchedAppleRow ? matchedAppleRow.id : null;

    // Insert the Strava workout row. metadata.strava captures the richer
    // Strava-only fields for traceability.
    const { error: insertError } = await supabase.from('workouts').insert({
      user_id: userId,
      source: 'strava',
      external_id: candidate.externalId,
      workout_type: candidate.workoutType,
      started_at: candidate.startedAt,
      ended_at: candidate.endedAt,
      local_date: candidate.localDate,
      duration_seconds: candidate.durationSeconds ?? null,
      distance_meters: candidate.distanceMeters,
      energy_kcal: candidate.energyKcal,
      avg_heart_rate: candidate.avgHr,
      max_heart_rate: candidate.maxHr,
      description: candidate.description,
      superseded_by: supersededBy,
      metadata: {
        strava: {
          activityId: candidate.externalId,
          name: activity.name ?? null,
          elevationGainM: candidate.elevationGainM,
        },
      },
    });
    if (insertError) {
      // Surface a clear error but keep going across the rest of the activities.
      console.error('strava sync: failed to insert workout', insertError);
      continue;
    }

    if (supersededBy) {
      linked += 1;
      // If the Apple row has no description yet and the Strava activity does,
      // forward it onto the canonical Apple row.
      if (matchedAppleRow && !matchedAppleRow.description && candidate.description) {
        await supabase
          .from('workouts')
          .update({ description: candidate.description })
          .eq('id', matchedAppleRow.id);
      }
    } else {
      inserted += 1;
    }
  }

  // Update last_synced_at.
  await supabase
    .from('user_integrations')
    .update({ last_synced_at: new Date(now).toISOString(), status: 'active' })
    .eq('id', row.id);

  return {
    ok: true,
    provider: 'strava',
    activitiesFetched: activities.length,
    workoutsInserted: inserted,
    workoutsLinkedToApple: linked,
    workoutsAlreadyPresent: alreadyPresent,
    tokenRefreshed,
  };
}
