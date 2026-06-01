import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Subscription entitlement + paywall gate. Processor-agnostic: reads the
 * subscription columns (migration 013) that a billing webhook syncs, and
 * decides whether the athlete has premium access. The Stripe (or other)
 * Checkout + webhook that WRITES these columns is a separate layer.
 *
 * Paid line: "free basics, paid AI" — the LLM surfaces require premium.
 *
 * OPT-IN: the gate is inert until BILLING_PAYWALL_ENABLED is on, so enabling
 * billing is a deliberate flip (and current users aren't suddenly locked out).
 */

export type Entitlement = {
  status: string | null;
  plan: string | null;
  periodEnd: string | null;
  /** True when the subscription grants premium access right now. */
  premium: boolean;
};

type UserSubscriptionRow = {
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_period_end: string | null;
};

// Statuses that grant access. `past_due` is intentionally still allowed for a
// grace window — dunning resolves it; we don't yank access on the first failed
// charge. `canceled`/null do not grant.
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function paywallEnabled(): boolean {
  const raw = process.env.BILLING_PAYWALL_ENABLED;
  return raw === 'true' || raw === '1';
}

/** Whether an entitlement grants premium access (status active, OR still
 * within a paid period that hasn't ended yet). */
export function hasPremiumAccess(entitlement: Entitlement, now: Date = new Date()): boolean {
  if (entitlement.status && ACTIVE_STATUSES.has(entitlement.status)) return true;
  // Honor a prepaid period that hasn't elapsed even if status drifted.
  if (entitlement.periodEnd && new Date(entitlement.periodEnd).getTime() > now.getTime()) return true;
  return false;
}

/** Read the athlete's subscription. Degrades to no-premium on any error
 * (e.g. migration 013 not applied) rather than throwing into a request. */
export async function loadEntitlement(supabase: SupabaseClient, userId: string): Promise<Entitlement> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('subscription_status, subscription_plan, subscription_period_end')
      .eq('id', userId)
      .limit(1);
    if (error) {
      console.warn('[billing] entitlement load failed:', error.message);
      return { status: null, plan: null, periodEnd: null, premium: false };
    }
    const row = (data as UserSubscriptionRow[] | null)?.[0];
    const entitlement: Entitlement = {
      status: row?.subscription_status ?? null,
      plan: row?.subscription_plan ?? null,
      periodEnd: row?.subscription_period_end ?? null,
      premium: false,
    };
    entitlement.premium = hasPremiumAccess(entitlement);
    return entitlement;
  } catch (err) {
    console.warn('[billing] entitlement load threw:', err instanceof Error ? err.message : String(err));
    return { status: null, plan: null, periodEnd: null, premium: false };
  }
}

/**
 * Gate for premium (LLM) routes. Allows when the paywall is off (opt-in) OR
 * the athlete has premium access. When it blocks, the route should 402 and
 * prompt an upgrade.
 */
export async function checkPaywallGate(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ allowed: boolean; enforced: boolean; entitlement: Entitlement | null }> {
  if (!paywallEnabled()) return { allowed: true, enforced: false, entitlement: null };
  const entitlement = await loadEntitlement(supabase, userId);
  return { allowed: entitlement.premium, enforced: true, entitlement };
}
