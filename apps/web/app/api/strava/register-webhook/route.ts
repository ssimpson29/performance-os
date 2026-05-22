import { NextResponse } from 'next/server';

import { requireStravaEnv, requireStravaWebhookVerifyToken } from '@/lib/env';
import { getAuthenticatedUserId } from '@/lib/server-auth';

/**
 * One-time (per deployment) registration of the Strava push subscription.
 * Auth-scoped because this is admin-level tooling — Strava only allows ONE
 * subscription per app, so any authenticated athlete can manage it for a
 * single-tenant deployment.
 *
 * - `GET` returns the currently registered subscription (if any).
 * - `POST` clears any existing subscription and creates a fresh one pointing
 *   at this deployment's webhook URL. Idempotent: calling it twice yields
 *   the same end state.
 *
 * The actual webhook receiver lives at /api/webhooks/strava.
 */

const STRAVA_PUSH_SUBSCRIPTIONS_URL = 'https://www.strava.com/api/v3/push_subscriptions';

type StravaSubscription = {
  id: number;
  resource_state?: number;
  application_id?: number;
  callback_url?: string;
  created_at?: string;
  updated_at?: string;
};

async function listSubscriptions(clientId: string, clientSecret: string): Promise<StravaSubscription[]> {
  const url = new URL(STRAVA_PUSH_SUBSCRIPTIONS_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Strava list subscriptions failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as StravaSubscription[] | StravaSubscription | null;
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

async function deleteSubscription(id: number, clientId: string, clientSecret: string): Promise<void> {
  const url = new URL(`${STRAVA_PUSH_SUBSCRIPTIONS_URL}/${id}`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  const res = await fetch(url.toString(), { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(`Strava delete subscription failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function createSubscription(args: {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  verifyToken: string;
}): Promise<StravaSubscription> {
  const res = await fetch(STRAVA_PUSH_SUBSCRIPTIONS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      callback_url: args.callbackUrl,
      verify_token: args.verifyToken,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Strava create subscription failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as StravaSubscription;
}

export async function GET(_request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let stravaClientId: string;
  let stravaClientSecret: string;
  try {
    ({ stravaClientId, stravaClientSecret } = requireStravaEnv());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'strava misconfigured' },
      { status: 500 },
    );
  }

  try {
    const subscriptions = await listSubscriptions(stravaClientId, stravaClientSecret);
    return NextResponse.json({ ok: true, subscriptions });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 },
    );
  }
}

export async function POST(_request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let appUrl: string;
  let stravaClientId: string;
  let stravaClientSecret: string;
  let verifyToken: string;
  try {
    ({ appUrl, stravaClientId, stravaClientSecret } = requireStravaEnv());
    verifyToken = requireStravaWebhookVerifyToken();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'strava misconfigured' },
      { status: 500 },
    );
  }

  const callbackUrl = `${appUrl.replace(/\/$/, '')}/api/webhooks/strava`;

  try {
    // Strava only allows one subscription per app. Clear any existing one so
    // POST is idempotent and recovers from a stale registration.
    const existing = await listSubscriptions(stravaClientId, stravaClientSecret);
    for (const sub of existing) {
      await deleteSubscription(sub.id, stravaClientId, stravaClientSecret);
    }

    const created = await createSubscription({
      clientId: stravaClientId,
      clientSecret: stravaClientSecret,
      callbackUrl,
      verifyToken,
    });

    return NextResponse.json({
      ok: true,
      subscription: created,
      callbackUrl,
      replacedCount: existing.length,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 },
    );
  }
}
