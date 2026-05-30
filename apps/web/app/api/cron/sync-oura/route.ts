import { NextResponse } from 'next/server';

import { requireCronSecret } from '@/lib/env';
import { OuraRecoverySyncError, syncOuraRecovery } from '@/lib/oura/recovery-sync';
import { createServerSupabaseClient } from '@/lib/supabase-server';

// Scheduled Oura recovery sync. Vercel Cron (see vercel.json) hits this on a
// daily schedule. Oura has no webhook, so without this the data only updates
// when an athlete manually clicks "Sync now" — see the integration that went
// stale for 25 days. syncOuraRecovery resolves its own date range from each
// integration's last_synced_at, so a single run backfills any gap.
//
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is
// configured on the project. We fail closed if the secret is unset (500) or the
// header does not match (401), so this endpoint never runs unauthenticated even
// though it lives under the (otherwise public) /api/* path.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let secret: string;
  try {
    secret = requireCronSecret();
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'CRON_SECRET not configured.' },
      { status: 500 },
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerSupabaseClient();

  const { data: integrations, error } = await supabase
    .from('user_integrations')
    .select('user_id')
    .eq('provider', 'oura')
    .eq('status', 'active');

  if (error) {
    return NextResponse.json({ ok: false, provider: 'oura', error: error.message }, { status: 500 });
  }

  const userIds = [...new Set((integrations ?? []).map((row: { user_id: string }) => row.user_id))];

  const synced: Array<{ userId: string; syncedDays: number; tokenRefreshed: boolean }> = [];
  const failed: Array<{ userId: string; error: string; status?: number }> = [];

  // Sequential so one athlete's failure (expired refresh token, Oura outage)
  // never aborts the batch and we don't hammer the Oura API in parallel.
  for (const userId of userIds) {
    try {
      const result = await syncOuraRecovery(supabase, { userId });
      synced.push({ userId, syncedDays: result.syncedDays, tokenRefreshed: result.tokenRefreshed });
    } catch (err) {
      failed.push({
        userId,
        error: err instanceof Error ? err.message : 'Unknown Oura sync error.',
        status: err instanceof OuraRecoverySyncError ? err.status : undefined,
      });
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    provider: 'oura',
    integrations: userIds.length,
    syncedCount: synced.length,
    failedCount: failed.length,
    synced,
    failed,
  });
}
