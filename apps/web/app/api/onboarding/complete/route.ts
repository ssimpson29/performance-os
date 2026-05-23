import { NextResponse } from 'next/server';

import {
  markOnboardingComplete,
  upsertAthleteProfile,
  type AthleteProfilePatch,
} from '@/lib/profile/profile-writer';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * POST /api/onboarding/complete
 *
 * Auth-scoped completion endpoint for the /onboarding flow. Body:
 *   {
 *     profile: AthleteProfilePatch,
 *     injuries: Array<{ bodyPart: string; startedAt: string; endedAt?: string; notes?: string }>,
 *     raceSeed?: { raceName: string; raceDate: string; distanceKm?: number; elevationGainM?: number },
 *   }
 *
 * Sequence:
 *   1. upsertAthleteProfile with the form's profile patch
 *   2. Insert each injury into health_events (event_type='injury',
 *      metadata.source='onboarding')
 *   3. markOnboardingComplete sets users.onboarding_completed_at
 *   4. Return { ok: true, raceSeed } so the client can pass the seed
 *      through to /coach for the first plan-creation conversation.
 *
 * No partial-success rollback. If a step fails mid-way, the client
 * keeps the user in the form and they can retry; idempotent at the
 * profile level (we'd just re-upsert), and an orphan injury without
 * the timestamp is harmless (next retry will set it).
 */
export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const validation = validatePayload(payload);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { profile, injuries, raceSeed } = validation.value;

  const supabase = createServerSupabaseClient();

  try {
    await upsertAthleteProfile(supabase, userId, profile);

    if (injuries.length > 0) {
      const rows = injuries.map((injury) => ({
        user_id: userId,
        event_type: 'injury',
        title: `${injury.bodyPart} (onboarding)`,
        started_at: new Date(`${injury.startedAt}T00:00:00.000Z`).toISOString(),
        ended_at: injury.endedAt
          ? new Date(`${injury.endedAt}T00:00:00.000Z`).toISOString()
          : null,
        notes: injury.notes ?? null,
        metadata: { source: 'onboarding', bodyPart: injury.bodyPart },
      }));
      const { error: injuryError } = await supabase.from('health_events').insert(rows);
      if (injuryError) {
        return NextResponse.json(
          { error: `Failed to record injury history: ${injuryError.message}` },
          { status: 500 },
        );
      }
    }

    await markOnboardingComplete(supabase, userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, raceSeed: raceSeed ?? null });
}

type OnboardingPayload = {
  profile: AthleteProfilePatch;
  injuries: Array<{
    bodyPart: string;
    startedAt: string;
    endedAt?: string;
    notes?: string;
  }>;
  raceSeed?: {
    raceName: string;
    raceDate: string;
    distanceKm?: number;
    elevationGainM?: number;
  };
};

type ValidationResult =
  | { ok: true; value: OnboardingPayload }
  | { ok: false; error: string };

function validatePayload(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Payload must be an object.' };
  }
  const obj = raw as Record<string, unknown>;

  const profile = obj.profile;
  if (!profile || typeof profile !== 'object') {
    return { ok: false, error: 'profile must be an object.' };
  }

  const injuriesRaw = obj.injuries;
  if (!Array.isArray(injuriesRaw)) {
    return { ok: false, error: 'injuries must be an array (empty array is fine).' };
  }
  const injuries: OnboardingPayload['injuries'] = [];
  for (const inj of injuriesRaw) {
    if (!inj || typeof inj !== 'object') {
      return { ok: false, error: 'each injury must be an object.' };
    }
    const i = inj as Record<string, unknown>;
    if (typeof i.bodyPart !== 'string' || i.bodyPart.trim().length === 0) {
      return { ok: false, error: 'injury.bodyPart is required.' };
    }
    if (typeof i.startedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(i.startedAt)) {
      return { ok: false, error: 'injury.startedAt must be YYYY-MM-DD.' };
    }
    injuries.push({
      bodyPart: i.bodyPart,
      startedAt: i.startedAt,
      endedAt: typeof i.endedAt === 'string' ? i.endedAt : undefined,
      notes: typeof i.notes === 'string' ? i.notes : undefined,
    });
  }

  let raceSeed: OnboardingPayload['raceSeed'];
  if (obj.raceSeed != null) {
    const r = obj.raceSeed as Record<string, unknown>;
    if (typeof r.raceName !== 'string' || typeof r.raceDate !== 'string') {
      return { ok: false, error: 'raceSeed.raceName and raceSeed.raceDate are required when raceSeed is present.' };
    }
    raceSeed = {
      raceName: r.raceName,
      raceDate: r.raceDate,
      distanceKm: typeof r.distanceKm === 'number' ? r.distanceKm : undefined,
      elevationGainM: typeof r.elevationGainM === 'number' ? r.elevationGainM : undefined,
    };
  }

  return {
    ok: true,
    value: { profile: profile as AthleteProfilePatch, injuries, raceSeed },
  };
}
