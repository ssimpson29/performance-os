import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Consent for third-party-LLM processing of health data.
 *
 * The coach + longevity guru send wearable / lab / health data to an
 * OpenAI-compatible API. Apple HealthKit terms (5.1.3) and the wearable
 * providers require explicit, disclosed consent before sharing health data
 * with a third party. This module records + reads that consent (migration
 * 012) and provides an OPT-IN gate the LLM routes can enforce.
 *
 * Bump AI_DATA_CONSENT_VERSION when the disclosure materially changes — prior
 * consent then no longer counts as "current" and the athlete must re-accept.
 */

export const AI_DATA_CONSENT_VERSION = '2026-06-01';

export type AiConsent = {
  consentedAt: string | null;
  version: string | null;
  /** True only when consent exists AND matches the current notice version. */
  current: boolean;
};

type UserConsentRow = { ai_data_consent_at: string | null; ai_data_consent_version: string | null };

/** Enforcement is opt-in: routes block on missing consent only when this is on. */
export function consentEnforcementEnabled(): boolean {
  const raw = process.env.AI_REQUIRE_DATA_CONSENT;
  return raw === 'true' || raw === '1';
}

/**
 * Read the athlete's consent state. Degrades to "not consented" (current:
 * false) on any error — e.g. migration 012 not yet applied — rather than
 * throwing into a request path.
 */
export async function loadAiConsent(supabase: SupabaseClient, userId: string): Promise<AiConsent> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('ai_data_consent_at, ai_data_consent_version')
      .eq('id', userId)
      .limit(1);
    if (error) {
      console.warn('[ai-consent] load failed:', error.message);
      return { consentedAt: null, version: null, current: false };
    }
    const row = (data as UserConsentRow[] | null)?.[0];
    const consentedAt = row?.ai_data_consent_at ?? null;
    const version = row?.ai_data_consent_version ?? null;
    return { consentedAt, version, current: Boolean(consentedAt) && version === AI_DATA_CONSENT_VERSION };
  } catch (err) {
    console.warn('[ai-consent] load threw:', err instanceof Error ? err.message : String(err));
    return { consentedAt: null, version: null, current: false };
  }
}

/** Stamp consent at the current notice version. */
export async function recordAiConsent(
  supabase: SupabaseClient,
  userId: string,
  version: string = AI_DATA_CONSENT_VERSION,
  now: Date = new Date(),
): Promise<AiConsent> {
  const consentedAt = now.toISOString();
  const { error } = await supabase
    .from('users')
    .update({ ai_data_consent_at: consentedAt, ai_data_consent_version: version })
    .eq('id', userId);
  if (error) throw new Error(`Failed to record consent: ${error.message}`);
  return { consentedAt, version, current: version === AI_DATA_CONSENT_VERSION };
}

/**
 * Gate for LLM routes. Allows when enforcement is off (opt-in) OR the athlete
 * has current consent. When it blocks, the route should 403 and prompt the
 * athlete to accept the notice.
 */
export async function checkAiConsentGate(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ allowed: boolean; required: boolean; consent: AiConsent }> {
  const required = consentEnforcementEnabled();
  if (!required) {
    return { allowed: true, required: false, consent: { consentedAt: null, version: null, current: false } };
  }
  const consent = await loadAiConsent(supabase, userId);
  return { allowed: consent.current, required: true, consent };
}
