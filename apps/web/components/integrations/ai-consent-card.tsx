'use client';

import { useEffect, useState } from 'react';

type ConsentState = {
  current: boolean;
  consentedAt: string | null;
  version: string | null;
  expectedVersion?: string;
};

/**
 * Disclosure + consent capture for third-party-LLM processing of health data.
 * Self-fetches the athlete's consent state from /api/consent/ai-data. Shown on
 * the Integrations page so consent sits right next to where data sources are
 * connected.
 */
export function AiConsentCard() {
  const [state, setState] = useState<ConsentState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/consent/ai-data')
      .then((r) => r.json())
      .then((d) => {
        if (active) setState(d as ConsentState);
      })
      .catch(() => {
        if (active) setState({ current: false, consentedAt: null, version: null });
      });
    return () => {
      active = false;
    };
  }, []);

  async function accept() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/consent/ai-data', { method: 'POST' });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; consentedAt?: string; version?: string } | null;
      if (!r.ok || d?.ok === false) {
        setError(d?.error ?? `Failed to save (${r.status})`);
        return;
      }
      setState({ current: true, consentedAt: d?.consentedAt ?? null, version: d?.version ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  const disclosure = (
    <div className="space-y-2 text-sm leading-6 text-muted">
      <p>
        Performance OS sends the data you connect — workouts, recovery (Oura), and lab/biomarker
        values — to a third-party AI provider (an OpenAI-compatible API) so the Coach and Longevity
        Guru can generate personalized guidance.
      </p>
      <p>
        This is evidence-informed coaching, <span className="text-white">not medical advice</span>;
        review clinically out-of-range values with a physician. You can disconnect any source below
        at any time, which deletes the data we synced from it.
      </p>
    </div>
  );

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
      <p className="eyebrow">Data &amp; AI consent</p>
      {disclosure}
      <div className="mt-4">
        {state === null ? (
          <p className="text-sm text-muted">Loading consent status…</p>
        ) : state.current ? (
          <p className="text-sm text-emerald-300">
            Consented{state.consentedAt ? ` on ${state.consentedAt.slice(0, 10)}` : ''}.
          </p>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <button
              type="button"
              onClick={accept}
              disabled={saving}
              className="rounded-full bg-brand2 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'I understand and consent'}
            </button>
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}
