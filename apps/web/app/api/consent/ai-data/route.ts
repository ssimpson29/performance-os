import { NextResponse } from 'next/server';

import { AI_DATA_CONSENT_VERSION, loadAiConsent, recordAiConsent } from '@/lib/consent/ai-consent';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * Consent for third-party-LLM processing of health data, scoped to the
 * signed-in athlete.
 *   GET  → current consent state + the version the app expects.
 *   POST → record consent at the current notice version.
 */
export async function GET() {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerSupabaseClient();
  const consent = await loadAiConsent(supabase, userId);
  return NextResponse.json({ ...consent, expectedVersion: AI_DATA_CONSENT_VERSION });
}

export async function POST() {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const supabase = createServerSupabaseClient();
    const consent = await recordAiConsent(supabase, userId);
    return NextResponse.json({ ok: true, ...consent });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record consent.';
    console.error('[consent/ai-data] failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
