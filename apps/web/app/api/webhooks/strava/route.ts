import { NextResponse } from 'next/server';

import { requireStravaEnv, requireStravaWebhookVerifyToken } from '@/lib/env';
import {
  handleStravaActivityEvent,
  loadStravaIntegrationByOwnerId,
  StravaSyncError,
} from '@/lib/strava/activity-sync';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * Strava push-subscription webhook. See Phase 4 of
 * docs/plans/2026-05-22-strava-integration.md.
 *
 * - `GET` answers Strava's subscription verification challenge. Strava hits
 *   this once when the subscription is created (and again any time we
 *   re-register). We confirm `hub.verify_token` matches our env-stored
 *   token and echo back `hub.challenge`.
 * - `POST` receives `aspect_type='create' | 'update' | 'delete'` events for
 *   `object_type='activity'`. We look up the integration row by
 *   `owner_id`, fetch the single activity from Strava, and run the same
 *   matcher/insert pipeline the batch sync uses. Strava expects a 200
 *   within ~2s; the handler does the work inline because for a single
 *   activity it's fast, and the matcher is idempotent on retries.
 *
 * Authorization model:
 * Strava cannot carry a Supabase session cookie, so this is one of the
 * documented exceptions to the auth-scoped convention (alongside Oura /
 * Strava OAuth callbacks). The trust boundary is:
 *   1. `hub.verify_token` on the GET handshake confirms the caller is
 *      registering against our subscription;
 *   2. `owner_id` on the POST is mapped against our integrations table —
 *      events for athletes we don't recognize get acknowledged with a 200
 *      and dropped (fails closed).
 */

type WebhookEvent = {
  object_type?: string;
  object_id?: number | string;
  aspect_type?: 'create' | 'update' | 'delete';
  owner_id?: number | string;
  subscription_id?: number | string;
  event_time?: number;
  updates?: Record<string, unknown>;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode !== 'subscribe' || !challenge) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  let expectedToken: string;
  try {
    expectedToken = requireStravaWebhookVerifyToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'webhook misconfigured';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  if (token !== expectedToken) {
    return NextResponse.json({ ok: false, error: 'verify_token_mismatch' }, { status: 403 });
  }

  // Strava's docs are specific: echo back `{ "hub.challenge": <challenge> }`.
  return NextResponse.json({ 'hub.challenge': challenge });
}

export async function POST(request: Request) {
  let body: WebhookEvent;
  try {
    body = (await request.json()) as WebhookEvent;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // Ack non-activity events (athlete deauthorization events use
  // object_type='athlete'). We currently don't process those; respond 200
  // so Strava doesn't retry.
  if (body.object_type !== 'activity') {
    return NextResponse.json({ ok: true, ignored: 'non_activity_event' });
  }

  // Delete events: ack and skip. We intentionally don't auto-delete the
  // workout row — defer until the UX implications are clearer.
  if (body.aspect_type === 'delete') {
    return NextResponse.json({ ok: true, ignored: 'delete_event' });
  }

  if (body.aspect_type !== 'create' && body.aspect_type !== 'update') {
    return NextResponse.json({ ok: true, ignored: 'unknown_aspect_type' });
  }

  if (body.owner_id == null || body.object_id == null) {
    return NextResponse.json({ ok: false, error: 'missing_owner_or_object' }, { status: 400 });
  }

  let stravaClientId: string;
  let stravaClientSecret: string;
  try {
    ({ stravaClientId, stravaClientSecret } = requireStravaEnv());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'strava misconfigured';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const supabase = createServerSupabaseClient();

  try {
    const binding = await loadStravaIntegrationByOwnerId(supabase, body.owner_id);
    if (!binding) {
      // Unknown athlete on this app. Ack so Strava stops retrying; this
      // could legitimately happen if multiple environments ever share a
      // Strava app registration. Fails closed.
      return NextResponse.json({ ok: true, ignored: 'unknown_owner' });
    }

    const result = await handleStravaActivityEvent(supabase, {
      userId: binding.userId,
      integration: binding.integration,
      activityId: body.object_id,
      clientId: stravaClientId,
      clientSecret: stravaClientSecret,
    });

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    if (err instanceof StravaSyncError) {
      // 5xx → Strava retries; 4xx (e.g. bad token) → we surface and stop.
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.status },
      );
    }
    console.error('POST /api/webhooks/strava failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
