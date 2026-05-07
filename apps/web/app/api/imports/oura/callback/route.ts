import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { requireOuraEnv } from '@/lib/env';

function parseUserIdFromState(state: string | null): string | null {
  if (!state) return null;
  const prefix = 'oura-import:';
  return state.startsWith(prefix) ? state.slice(prefix.length) || null : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        provider: 'oura',
        error,
      },
      { status: 400 },
    );
  }

  if (!code) {
    return NextResponse.json(
      {
        ok: false,
        provider: 'oura',
        error: 'missing_code',
      },
      { status: 400 },
    );
  }

  const { appUrl, ouraClientId, ouraClientSecret } = requireOuraEnv();
  const redirectUri = `${appUrl.replace(/\/$/, '')}/api/imports/oura/callback`;

  const tokenResponse = await fetch('https://api.ouraring.com/oauth/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: ouraClientId,
      client_secret: ouraClientSecret,
    }).toString(),
  });

  const tokenPayload = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
  };

  if (!tokenResponse.ok || !tokenPayload.access_token) {
    return NextResponse.json(
      {
        ok: false,
        provider: 'oura',
        error: tokenPayload.error ?? 'token_exchange_failed',
      },
      { status: 400 },
    );
  }

  const userId = parseUserIdFromState(state);

  if (!userId) {
    return NextResponse.json({
      ok: true,
      provider: 'oura',
      state,
      codeReceived: true,
      integrationPersisted: false,
      nextStep: 'Bind Oura OAuth to an app user before persisting integration tokens.',
    });
  }

  const supabase = createServerSupabaseClient();
  const { error: upsertError } = await supabase.from('user_integrations').upsert(
    {
      user_id: userId,
      provider: 'oura',
      status: 'active',
      access_token_encrypted: tokenPayload.access_token,
      refresh_token_encrypted: tokenPayload.refresh_token ?? null,
      token_expires_at:
        typeof tokenPayload.expires_in === 'number'
          ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString()
          : null,
      metadata: {
        scope: tokenPayload.scope ?? null,
        tokenType: tokenPayload.token_type ?? null,
      },
    },
    { onConflict: 'user_id,provider' },
  );

  if (upsertError) {
    return NextResponse.json(
      {
        ok: false,
        provider: 'oura',
        error: upsertError.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    provider: 'oura',
    state,
    userId,
    codeReceived: true,
    integrationPersisted: true,
    nextStep: 'Oura tokens stored. Recovery sync can run next.',
  });
}
