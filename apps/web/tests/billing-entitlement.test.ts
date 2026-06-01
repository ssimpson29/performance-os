import { afterEach, describe, expect, it } from 'vitest';

import {
  checkPaywallGate,
  hasPremiumAccess,
  loadEntitlement,
  paywallEnabled,
} from '../lib/billing/entitlement';

function makeSupabase(opts: {
  row?: { subscription_status: string | null; subscription_plan: string | null; subscription_period_end: string | null } | null;
  error?: { message: string } | null;
}) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.limit = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: opts.row === undefined ? [] : opts.row ? [opts.row] : [], error: opts.error ?? null });
  return { from: () => builder } as never;
}

const ENV = 'BILLING_PAYWALL_ENABLED';
const ent = (status: string | null, periodEnd: string | null = null) => ({ status, plan: null, periodEnd, premium: false });

describe('hasPremiumAccess', () => {
  it('grants on active/trialing/past_due, denies on canceled/null', () => {
    expect(hasPremiumAccess(ent('active'))).toBe(true);
    expect(hasPremiumAccess(ent('trialing'))).toBe(true);
    expect(hasPremiumAccess(ent('past_due'))).toBe(true); // grace window
    expect(hasPremiumAccess(ent('canceled'))).toBe(false);
    expect(hasPremiumAccess(ent(null))).toBe(false);
  });

  it('honors a not-yet-elapsed paid period even if status drifted', () => {
    const future = new Date(Date.now() + 5 * 864e5).toISOString();
    const past = new Date(Date.now() - 5 * 864e5).toISOString();
    expect(hasPremiumAccess(ent('canceled', future))).toBe(true);
    expect(hasPremiumAccess(ent('canceled', past))).toBe(false);
  });
});

describe('loadEntitlement', () => {
  it('computes premium from the row', async () => {
    const e = await loadEntitlement(makeSupabase({ row: { subscription_status: 'active', subscription_plan: 'pro', subscription_period_end: null } }), 'u1');
    expect(e).toMatchObject({ status: 'active', plan: 'pro', premium: true });
  });

  it('degrades to no-premium on error (e.g. migration not applied)', async () => {
    const e = await loadEntitlement(makeSupabase({ error: { message: 'column does not exist' } }), 'u1');
    expect(e).toEqual({ status: null, plan: null, periodEnd: null, premium: false });
  });
});

describe('checkPaywallGate', () => {
  const saved = process.env[ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  it('allows without querying when the paywall is off', async () => {
    delete process.env[ENV];
    expect(paywallEnabled()).toBe(false);
    const res = await checkPaywallGate(makeSupabase({ row: null }), 'u1');
    expect(res).toMatchObject({ allowed: true, enforced: false });
  });

  it('blocks non-subscribers and allows subscribers when enabled', async () => {
    process.env[ENV] = 'true';
    const blocked = await checkPaywallGate(makeSupabase({ row: { subscription_status: null, subscription_plan: null, subscription_period_end: null } }), 'u1');
    expect(blocked).toMatchObject({ allowed: false, enforced: true });

    const allowed = await checkPaywallGate(makeSupabase({ row: { subscription_status: 'active', subscription_plan: 'pro', subscription_period_end: null } }), 'u1');
    expect(allowed.allowed).toBe(true);
  });
});
