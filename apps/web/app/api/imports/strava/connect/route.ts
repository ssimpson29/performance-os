import { NextResponse } from 'next/server';

import { requireStravaEnv } from '@/lib/env';
import { getAuthenticatedUserId } from '@/lib/server-auth';

export async function GET(_request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { appUrl, stravaClientId } = requireStravaEnv();
  const redirectUri = `${appUrl.replace(/\/$/, '')}/api/imports/strava/callback`;
  const params = new URLSearchParams({
    client_id: stravaClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state: `strava-import:${userId}`,
  });

  return NextResponse.redirect(`https://www.strava.com/oauth/authorize?${params.toString()}`);
}
