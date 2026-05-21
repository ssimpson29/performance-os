import Link from 'next/link';

import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';

import { loadLongevityPageState } from './longevity-data';
import { ReevaluateButton } from './reevaluate-button';

export default async function LongevityPage() {
  const state = await loadLongevityPageState();

  return (
    <main>
      <PageHero
        eyebrow="Longevity Guru"
        title="The lever that moves healthspan, not race day."
        description="Biomarkers, trends, and life inputs distilled into the top 1–3 things to work on right now. Distinct from the Training Coach — different time horizon, different signals, but they share data and surface conflicts honestly."
        badge={state.kind === 'ready' ? 'Live evaluation' : 'Longevity preview'}
      />

      <section className="shell pb-8">
        {state.kind === 'unauthenticated' ? (
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Sign in to see your longevity picture</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                The Guru reads your biomarker history; it needs to know who you are first.
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Head to Integrations to send yourself a magic link, then come back.
              </p>
            </div>
            <Link
              href="/settings/integrations"
              className="inline-flex items-center justify-center self-start rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black"
            >
              Go to Integrations
            </Link>
          </Card>
        ) : null}

        {state.kind === 'no-data' ? (
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Upload a biomarker panel</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                The Guru needs a lab panel to evaluate.
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Import a panel via <code className="text-brand2">POST /api/imports/biomarker-panel</code>
                {' '}with a JSON body of <code>{'{ panelDate, markers: [{ markerKey, value, unit }, …] }'}</code>. Supported marker keys live in
                {' '}<code className="text-brand2">apps/web/lib/longevity/reference-ranges.ts</code>.
                {' '}A no-code UI for panel uploads is a follow-up.
              </p>
            </div>
          </Card>
        ) : null}

        {state.kind === 'ready' ? (
          <div className="space-y-6">
            <Card className="space-y-2">
              <p className="eyebrow">Most recent panel</p>
              <h2 className="text-xl font-semibold text-white">
                {state.latestPanel?.panelName ?? 'Lab panel'}
                {state.latestPanel?.provider ? ` · ${state.latestPanel.provider}` : ''}
              </h2>
              <p className="text-sm leading-6 text-muted">
                {state.latestPanel ? `Drawn ${state.latestPanel.panelDate}` : 'No panel on record'}
              </p>
              <ReevaluateButton />
            </Card>

            {state.longevityContext ? (
              <Card
                className={
                  state.longevityContext.recoveryPriority === 'elevated'
                    ? 'border-amber-400/30 bg-amber-400/[0.05] space-y-2'
                    : 'space-y-2'
                }
              >
                <p className="eyebrow">Cross-write to Training Coach</p>
                <h3 className="text-lg font-semibold text-white capitalize">
                  Recovery priority: {state.longevityContext.recoveryPriority}
                </h3>
                <p className="text-sm leading-6 text-muted">{state.longevityContext.notes}</p>
              </Card>
            ) : null}

            <Card className="space-y-4">
              <div>
                <p className="eyebrow">Top levers</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  {state.priorities.length === 0
                    ? 'No levers flagged this evaluation.'
                    : 'Work on these first.'}
                </h2>
              </div>
              {state.narrative ? <p className="text-sm leading-6 text-muted">{state.narrative}</p> : null}
              {state.priorities.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-3">
                  {state.priorities.map((p) => (
                    <div key={p.leverKey} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-brand2">{p.leverKey}</p>
                      <p className="mt-2 text-sm font-medium text-white">Severity {p.severity.toFixed(1)}</p>
                      <p className="mt-2 text-sm text-muted">{p.recommendation}</p>
                      <p className="mt-2 text-xs text-muted">Contributing: {p.contributingMarkers.join(', ')}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {state.cautions.length ? (
                <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.04] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-amber-300">Cautions</p>
                  <ul className="mt-2 space-y-1 text-sm text-muted">
                    {state.cautions.map((c, i) => (
                      <li key={i}>• {c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>

            {state.watching.length ? (
              <Card className="space-y-2">
                <p className="eyebrow">Watching</p>
                <ul className="space-y-1 text-sm text-muted">
                  {state.watching.map((w) => (
                    <li key={w.leverKey}>
                      • <span className="text-white">{w.leverKey}</span> (severity {w.severity.toFixed(1)})
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
