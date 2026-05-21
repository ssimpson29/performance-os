import { NextResponse } from 'next/server';

import { requireOuraEnv } from '@/lib/env';
import { getAuthenticatedUserId } from '@/lib/server-auth';

export async function GET(_request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { appUrl, ouraClientId } = requireOuraEnv();
  const redirectUri = `${appUrl.replace(/\/$/, '')}/api/imports/oura/callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ouraClientId,
    redirect_uri: redirectUri,
    scope: 'daily heartrate personal email workout session',
    state: `oura-import:${userId}`,
  });

  return NextResponse.redirect(`https://cloud.ouraring.com/oauth/authorize?${params.toString()}`);
}
