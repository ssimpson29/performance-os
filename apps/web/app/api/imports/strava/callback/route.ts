import { NextResponse } from 'next/server';

import { requireStravaEnv } from '@/lib/env';
import { createServerSupabaseClient } from '@/lib/supabase-server';

function parseUserIdFromState(state: string | null): string | null {
  if (!state) return null;
  const prefix = 'strava-import:';
  return state.startsWith(prefix) ? state.slice(prefix.length) || null : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return NextResponse.json({ ok: false, provider: 'strava', error }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json(
      { ok: false, provider: 'strava', error: 'missing_code' },
      { status: 400 },
    );
  }

  const { stravaClientId, stravaClientSecret } = requireStravaEnv();
  const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: stravaClientId,
      client_secret: stravaClientSecret,
      code,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const tokenPayload = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    athlete?: { id?: number };
    errors?: unknown;
  };
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    return NextResponse.json(
      { ok: false, provider: 'strava', error: 'token_exchange_failed' },
      { status: 400 },
    );
  }

  const userId = parseUserIdFromState(state);
  if (!userId) {
    return NextResponse.json({
      ok: true,
      provider: 'strava',
      state,
      codeReceived: true,
      integrationPersisted: false,
      nextStep: 'Bind Strava OAuth to an app user before persisting integration tokens.',
    });
  }

  const supabase = createServerSupabaseClient();
  const { error: upsertError } = await supabase.from('user_integrations').upsert(
    {
      user_id: userId,
      provider: 'strava',
      status: 'active',
      external_user_id: tokenPayload.athlete?.id?.toString() ?? null,
      access_token_encrypted: tokenPayload.access_token,
      refresh_token_encrypted: tokenPayload.refresh_token ?? null,
      token_expires_at: tokenPayload.expires_at
        ? new Date(tokenPayload.expires_at * 1000).toISOString()
        : null,
      metadata: { athleteId: tokenPayload.athlete?.id ?? null },
    },
    { onConflict: 'user_id,provider' },
  );
  if (upsertError) {
    return NextResponse.json(
      { ok: false, provider: 'strava', error: upsertError.message },
      { status: 500 },
    );
  }

  return NextResponse.redirect(new URL('/settings/integrations?strava=connected', url.origin));
}
