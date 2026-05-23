import { NextResponse } from 'next/server';

import {
  upsertAthleteProfile,
  type AthleteProfilePatch,
} from '@/lib/profile/profile-writer';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * PATCH /api/profile — auth-scoped partial update for the athlete
 * profile. Mirrors what /api/onboarding/complete does for the profile
 * portion, MINUS the markOnboardingComplete step, so editing on the
 * /account page doesn't re-stamp the onboarding timestamp.
 *
 * Body: AthleteProfilePatch (camelCase keys, undefined keys preserved).
 * Returns { ok: true, profile } on success.
 */
export async function PATCH(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be an object.' }, { status: 400 });
  }

  const patch = body as AthleteProfilePatch;
  const supabase = createServerSupabaseClient();
  try {
    const profile = await upsertAthleteProfile(supabase, userId, patch);
    return NextResponse.json({ ok: true, profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
