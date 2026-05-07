import { NextResponse } from 'next/server';

import { requireOuraEnv } from '@/lib/env';

export async function GET(request: Request) {
  const { appUrl, ouraClientId } = requireOuraEnv();
  const url = new URL(request.url);
  const redirectUri = `${appUrl.replace(/\/$/, '')}/api/imports/oura/callback`;
  const userId = url.searchParams.get('userId')?.trim();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ouraClientId,
    redirect_uri: redirectUri,
    scope: 'daily heartrate personal email workout session',
    state: userId ? `oura-import:${userId}` : 'oura-import',
  });

  return NextResponse.redirect(`https://cloud.ouraring.com/oauth/authorize?${params.toString()}`);
}
