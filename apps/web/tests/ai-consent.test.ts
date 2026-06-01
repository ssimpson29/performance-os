import { afterEach, describe, expect, it } from 'vitest';

import {
  AI_DATA_CONSENT_VERSION,
  checkAiConsentGate,
  consentEnforcementEnabled,
  loadAiConsent,
  recordAiConsent,
} from '../lib/consent/ai-consent';

// users-table stub: select(...).eq().limit() -> {data,error}; update(...).eq() -> {error}.
function makeSupabase(opts: {
  row?: { ai_data_consent_at: string | null; ai_data_consent_version: string | null } | null;
  selectError?: { message: string } | null;
  updateError?: { message: string } | null;
  onUpdate?: (vals: Record<string, unknown>) => void;
}) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.update = (vals: Record<string, unknown>) => {
    opts.onUpdate?.(vals);
    return builder;
  };
  builder.eq = () => builder;
  builder.limit = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve(
      // select path resolves {data,error}; update path resolves {error}.
      { data: opts.row === undefined ? [] : opts.row ? [opts.row] : [], error: opts.selectError ?? opts.updateError ?? null },
    );
  return { from: () => builder } as never;
}

const ENV = 'AI_REQUIRE_DATA_CONSENT';

describe('consentEnforcementEnabled', () => {
  const saved = process.env[ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  it('off by default, on for true/1', () => {
    delete process.env[ENV];
    expect(consentEnforcementEnabled()).toBe(false);
    process.env[ENV] = 'true';
    expect(consentEnforcementEnabled()).toBe(true);
    process.env[ENV] = '1';
    expect(consentEnforcementEnabled()).toBe(true);
    process.env[ENV] = 'yes';
    expect(consentEnforcementEnabled()).toBe(false);
  });
});

describe('loadAiConsent', () => {
  it('current=true only when stamped AND version matches', async () => {
    const ok = await loadAiConsent(makeSupabase({ row: { ai_data_consent_at: '2026-06-01T00:00:00Z', ai_data_consent_version: AI_DATA_CONSENT_VERSION } }), 'u1');
    expect(ok.current).toBe(true);

    const stale = await loadAiConsent(makeSupabase({ row: { ai_data_consent_at: '2025-01-01T00:00:00Z', ai_data_consent_version: 'old' } }), 'u1');
    expect(stale.current).toBe(false);

    const never = await loadAiConsent(makeSupabase({ row: { ai_data_consent_at: null, ai_data_consent_version: null } }), 'u1');
    expect(never.current).toBe(false);
  });

  it('degrades to not-consented on error (e.g. migration not applied)', async () => {
    const res = await loadAiConsent(makeSupabase({ selectError: { message: 'column does not exist' } }), 'u1');
    expect(res).toEqual({ consentedAt: null, version: null, current: false });
  });
});

describe('recordAiConsent', () => {
  it('stamps the current version + timestamp', async () => {
    let updated: Record<string, unknown> | null = null;
    const res = await recordAiConsent(makeSupabase({ onUpdate: (v) => (updated = v) }), 'u1', undefined, new Date('2026-06-01T12:00:00Z'));
    expect(res.current).toBe(true);
    expect(updated).toMatchObject({ ai_data_consent_version: AI_DATA_CONSENT_VERSION, ai_data_consent_at: '2026-06-01T12:00:00.000Z' });
  });

  it('throws on update error', async () => {
    await expect(recordAiConsent(makeSupabase({ updateError: { message: 'boom' } }), 'u1')).rejects.toThrow(/boom/);
  });
});

describe('checkAiConsentGate', () => {
  const saved = process.env[ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  it('allows without querying when enforcement is off', async () => {
    delete process.env[ENV];
    const res = await checkAiConsentGate(makeSupabase({ row: null }), 'u1');
    expect(res).toMatchObject({ allowed: true, required: false });
  });

  it('blocks when enforcement on and no current consent, allows when consented', async () => {
    process.env[ENV] = 'true';
    const blocked = await checkAiConsentGate(makeSupabase({ row: { ai_data_consent_at: null, ai_data_consent_version: null } }), 'u1');
    expect(blocked).toMatchObject({ allowed: false, required: true });

    const allowed = await checkAiConsentGate(makeSupabase({ row: { ai_data_consent_at: '2026-06-01T00:00:00Z', ai_data_consent_version: AI_DATA_CONSENT_VERSION } }), 'u1');
    expect(allowed.allowed).toBe(true);
  });
});
