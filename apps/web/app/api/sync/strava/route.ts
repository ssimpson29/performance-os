import { NextResponse } from 'next/server';

import { requireStravaEnv } from '@/lib/env';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { StravaSyncError, syncStravaActivities } from '@/lib/strava/activity-sync';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { afterDate?: string } | null;

  try {
    const { stravaClientId, stravaClientSecret } = requireStravaEnv();
    const supabase = createServerSupabaseClient();
    const result = await syncStravaActivities(supabase, {
      userId,
      clientId: stravaClientId,
      clientSecret: stravaClientSecret,
      options: { afterDate: body?.afterDate },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof StravaSyncError) {
      return NextResponse.json({ ok: false, provider: 'strava', error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Unknown Strava sync error.';
    console.error('POST /api/sync/strava failed:', err);
    return NextResponse.json({ ok: false, provider: 'strava', error: message }, { status: 500 });
  }
}
