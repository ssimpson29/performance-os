import type { SupabaseClient } from '@supabase/supabase-js';

import { getStravaEnv } from '@/lib/env';

import { ensureFreshStravaToken } from './activity-sync';

const STRAVA_DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';

type StravaIntegrationRow = {
  id: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
};

/**
 * Best-effort revoke of OUR Strava authorization at Strava (POST
 * /oauth/deauthorize). Called on in-app disconnect so the athlete's Strava
 * "My Apps" no longer lists us and Strava stops pushing webhooks.
 *
 * Never throws: deleting our stored data (disconnectIntegration) is the
 * compliance source of truth; the provider-side revoke is a courtesy on top.
 * Must run BEFORE the integration row is deleted (it needs the token).
 */
export async function deauthorizeStravaForUser(
  supabase: SupabaseClient,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ revoked: boolean }> {
  try {
    const { stravaClientId, stravaClientSecret } = getStravaEnv();
    if (!stravaClientId || !stravaClientSecret) return { revoked: false };

    const { data } = await supabase
      .from('user_integrations')
      .select('id, access_token_encrypted, refresh_token_encrypted, token_expires_at')
      .eq('user_id', userId)
      .eq('provider', 'strava')
      .limit(1)
      .maybeSingle();
    const integration = data as StravaIntegrationRow | null;
    if (!integration?.access_token_encrypted) return { revoked: false };

    const { accessToken } = await ensureFreshStravaToken(supabase, {
      integration: integration as never,
      clientId: stravaClientId,
      clientSecret: stravaClientSecret,
    });

    const res = await fetchImpl(STRAVA_DEAUTHORIZE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    return { revoked: res.ok };
  } catch (err) {
    console.warn('[strava-deauthorize] best-effort revoke failed:', err instanceof Error ? err.message : String(err));
    return { revoked: false };
  }
}
