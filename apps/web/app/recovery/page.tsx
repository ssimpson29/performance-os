import Link from 'next/link';

import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';

import { loadRecoveryPageState, type RecoveryDay, type RecoveryFlag } from './recovery-data';

const FLAG_STYLES: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/30',
  yellow: 'bg-amber-400/10 text-amber-300 border-amber-400/30',
  red: 'bg-rose-400/10 text-rose-300 border-rose-400/30',
};

function FlagPill({ flag }: { flag: RecoveryFlag }) {
  if (!flag) return <span className="text-muted">—</span>;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${FLAG_STYLES[flag]}`}>
      {flag}
    </span>
  );
}

function Metric({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  return (
    <Card className="space-y-1">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="text-2xl font-semibold text-white">
        {value ?? '—'}
        {value != null && unit ? <span className="ml-1 text-sm font-normal text-muted">{unit}</span> : null}
      </p>
    </Card>
  );
}

const TREND_COPY: Record<string, string> = {
  improving: 'Recovery trending up',
  stable: 'Recovery holding steady',
  degrading: 'Recovery trending down',
};

export default async function RecoveryPage() {
  const state = await loadRecoveryPageState();

  return (
    <main>
      <PageHero
        eyebrow="Recovery intelligence"
        title="Your readiness, HRV, and resting HR over time."
        description="Sleep, readiness, and cardiovascular signals from Oura — shown beside their baseline so you can tell whether load is being absorbed."
        badge={state.kind === 'ready' && state.latest ? state.latest.day : 'Recovery'}
      />

      {state.kind === 'unauthenticated' ? (
        <section className="shell pb-16">
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Sign in to see your recovery</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Recovery reads your athlete account — sign in first.
              </h2>
            </div>
            <Link
              href="/settings/integrations"
              className="inline-flex items-center self-start rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black"
            >
              Go to Integrations
            </Link>
          </Card>
        </section>
      ) : null}

      {state.kind === 'ready' && state.days.length === 0 ? (
        <section className="shell pb-16">
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">No recovery data yet</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Connect Oura and run a sync to populate this page.
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Once connected, readiness, sleep, HRV, and resting heart rate land here daily.
              </p>
            </div>
            <Link
              href="/settings/integrations"
              className="inline-flex items-center self-start rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black"
            >
              Go to Integrations
            </Link>
          </Card>
        </section>
      ) : null}

      {state.kind === 'ready' && state.days.length > 0 ? (
        <>
          {/* Latest snapshot */}
          <section className="shell pt-2">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.18em] text-brand2">
                Latest{state.latest ? ` · ${state.latest.day}` : ''}
              </p>
              {state.latest ? <FlagPill flag={state.latest.flag} /> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Readiness" value={state.latest?.readinessScore ?? null} />
              <Metric label="Sleep" value={state.latest?.sleepScore ?? null} />
              <Metric label="HRV" value={state.latest?.hrvMs ?? null} unit="ms" />
              <Metric label="Resting HR" value={state.latest?.restingHr ?? null} unit="bpm" />
            </div>
          </section>

          {/* Baseline + trend */}
          <section className="shell pt-6">
            <Card className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs uppercase tracking-[0.18em] text-muted">
                  Baseline · last {state.lookbackDays} days ({state.baseline.daysWithData} with data)
                </p>
                <p className="text-sm text-white">
                  {TREND_COPY[state.trend.direction] ?? 'Recovery'}{' '}
                  <span className="text-muted">
                    ({Math.round(state.trend.confidence * 100)}% confidence, {state.trend.sampleCount} samples)
                  </span>
                </p>
              </div>
              <div className="grid gap-4 text-sm sm:grid-cols-4">
                <p className="text-muted">Avg readiness <span className="text-white">{state.baseline.avgReadiness ?? '—'}</span></p>
                <p className="text-muted">Avg sleep <span className="text-white">{state.baseline.avgSleep ?? '—'}</span></p>
                <p className="text-muted">Avg HRV <span className="text-white">{state.baseline.avgHrv ?? '—'}{state.baseline.avgHrv != null ? ' ms' : ''}</span></p>
                <p className="text-muted">Avg resting HR <span className="text-white">{state.baseline.avgRestingHr ?? '—'}{state.baseline.avgRestingHr != null ? ' bpm' : ''}</span></p>
              </div>
            </Card>
          </section>

          {/* History */}
          <section className="shell pb-16 pt-6">
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-[0.14em] text-muted">
                    <th className="pb-2 pr-4 font-medium">Day</th>
                    <th className="pb-2 pr-4 font-medium">Readiness</th>
                    <th className="pb-2 pr-4 font-medium">Sleep</th>
                    <th className="pb-2 pr-4 font-medium">HRV</th>
                    <th className="pb-2 pr-4 font-medium">Resting HR</th>
                    <th className="pb-2 font-medium">Flag</th>
                  </tr>
                </thead>
                <tbody className="text-white">
                  {state.days.map((d: RecoveryDay) => (
                    <tr key={d.day} className="border-t border-white/5">
                      <td className="py-2 pr-4 text-muted">{d.day}</td>
                      <td className="py-2 pr-4">{d.readinessScore ?? '—'}</td>
                      <td className="py-2 pr-4">{d.sleepScore ?? '—'}</td>
                      <td className="py-2 pr-4">{d.hrvMs ?? '—'}</td>
                      <td className="py-2 pr-4">{d.restingHr ?? '—'}</td>
                      <td className="py-2"><FlagPill flag={d.flag} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        </>
      ) : null}
    </main>
  );
}
