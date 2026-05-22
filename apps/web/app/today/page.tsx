import Link from 'next/link';

import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';

import { loadTodayPageState } from './today-data';

function StatLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <p className="text-sm leading-6 text-muted">
      <span className="text-xs uppercase tracking-[0.18em] text-brand2">{label}: </span>
      <span className="text-white">{value}</span>
    </p>
  );
}

export default async function TodayPage() {
  const state = await loadTodayPageState();

  return (
    <main>
      <PageHero
        eyebrow="Daily brief"
        title="Today&apos;s call — what to do and why."
        description="Reads your active training plan, recent workouts, and recovery to compose the exact session for today, plus the strength routine, fuel target, and notes that go with it."
        badge={state.kind === 'ready' ? `${state.day}` : 'Today'}
      />

      <section className="shell pb-16">
        {state.kind === 'unauthenticated' ? (
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Sign in to see today&apos;s call</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Today reads your athlete profile — sign in first.
              </h2>
            </div>
            <Link
              href="/settings/integrations"
              className="inline-flex items-center self-start rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black"
            >
              Go to Integrations
            </Link>
          </Card>
        ) : null}

        {state.kind === 'no-plan' ? (
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Upload a plan first</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Today builds itself from your imported training plan.
              </h2>
            </div>
            <Link
              href="/plan/import"
              className="inline-flex items-center self-start rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black"
            >
              Import plan
            </Link>
          </Card>
        ) : null}

        {state.kind === 'ready' ? (
          <div className="space-y-6">
            {state.activeFollowUp ? (
              <Card className="border-amber-400/30 bg-amber-400/[0.05] space-y-2">
                <p className="eyebrow text-amber-300">Active follow-up</p>
                <h3 className="text-lg font-semibold text-white">
                  Keep work easy through {state.activeFollowUp.easyThroughDate}
                  {state.activeFollowUp.bodyPart ? ` — watching the ${state.activeFollowUp.bodyPart}` : ''}
                </h3>
                <p className="text-sm text-muted">
                  Coach will re-evaluate on {state.activeFollowUp.checkInDate}.
                </p>
              </Card>
            ) : null}

            <Card className="space-y-4">
              <div>
                <p className="eyebrow">{state.day}&apos;s session</p>
                <h2 className="mt-1 text-3xl font-semibold text-white">
                  {state.adaptedRecommendation?.recommendedSessionType ?? state.anchorSession?.runSession ?? 'Rest'}
                </h2>
                <p className="mt-2 text-base leading-7 text-muted">
                  {state.anchorSession?.details ?? 'No anchor session in the plan for today — take it easy.'}
                </p>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {state.anchorSession?.exactWork ? (
                  <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-brand2">Exact work</p>
                    <p className="mt-2 text-sm text-white">{state.anchorSession.exactWork}</p>
                  </div>
                ) : null}
                {state.anchorSession?.strengthMobility ? (
                  <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-brand2">Strength / mobility</p>
                    <p className="mt-2 text-sm text-white">{state.anchorSession.strengthMobility}</p>
                  </div>
                ) : null}
              </div>

              {state.adaptedRecommendation && state.adaptedRecommendation.action !== 'keep' ? (
                <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.04] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-amber-300">Coach adjustment</p>
                  <p className="mt-2 text-sm text-white">
                    Adjusted from {state.adaptedRecommendation.baseSessionType} →{' '}
                    {state.adaptedRecommendation.recommendedSessionType}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted">{state.adaptedRecommendation.reason}</p>
                </div>
              ) : null}

              {state.coachMessage ? (
                <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-brand2">Coach call (most recent)</p>
                  <p className="mt-2 text-sm leading-6 text-white">{state.coachMessage}</p>
                  <Link
                    href="/coach"
                    className="mt-3 inline-flex items-center rounded-full border border-white/10 px-3 py-1 text-xs font-medium text-white"
                  >
                    Open chat →
                  </Link>
                </div>
              ) : (
                <p className="text-sm italic text-muted">
                  No coach run logged for today yet. <Link href="/coach" className="text-brand2">Talk to the coach</Link> to capture a daily call.
                </p>
              )}
            </Card>

            <Card className="space-y-3">
              <p className="eyebrow">This week&apos;s phase target</p>
              {state.phaseName ? (
                <h3 className="text-lg font-semibold text-white">
                  {state.phaseName}
                  {state.weeksToRace != null ? ` · ${state.weeksToRace} weeks to race` : ''}
                  {state.isRaceWeek ? ' · RACE WEEK' : state.isTaper ? ' · taper' : ''}
                </h3>
              ) : null}
              {state.phaseWeekTarget ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <StatLine label="Mileage" value={state.phaseWeekTarget.mileageTarget} />
                  <StatLine label="Vert" value={state.phaseWeekTarget.vertTarget} />
                  <StatLine label="Saturday" value={state.phaseWeekTarget.saturdayTarget} />
                  <StatLine label="Sunday" value={state.phaseWeekTarget.sundayTarget} />
                  <StatLine label="Thursday" value={state.phaseWeekTarget.thursdayTarget} />
                  <StatLine label="Fuel" value={state.phaseWeekTarget.fuelTarget} />
                  <StatLine label="Key focus" value={state.phaseWeekTarget.keyFocus} />
                  <StatLine label="Notes" value={state.phaseWeekTarget.notes} />
                </div>
              ) : (
                <p className="text-sm italic text-muted">No phase-week target for today.</p>
              )}
            </Card>

            {state.strengthTemplate ? (
              <Card className="space-y-3">
                <div>
                  <p className="eyebrow">{state.strengthTemplate.name}</p>
                  <h3 className="text-lg font-semibold text-white">Today&apos;s strength routine</h3>
                </div>
                <ul className="space-y-2">
                  {state.strengthTemplate.items.map((item, i) => (
                    <li key={i} className="rounded-2xl border border-white/5 bg-white/[0.03] p-3">
                      <p className="text-sm font-medium text-white">{item.label}</p>
                      <p className="mt-1 text-xs text-muted">
                        {item.prescription}
                        {item.focus ? ` · ${item.focus}` : ''}
                        {item.notes ? ` · ${item.notes}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {state.dailyRoutine ? (
              <Card className="space-y-3">
                <div>
                  <p className="eyebrow">Daily routine</p>
                  <h3 className="text-lg font-semibold text-white">Do these after your run</h3>
                </div>
                <ul className="space-y-2">
                  {state.dailyRoutine.items.map((item, i) => (
                    <li key={i} className="rounded-2xl border border-white/5 bg-white/[0.03] p-3">
                      <p className="text-sm font-medium text-white">{item.label}</p>
                      <p className="mt-1 text-xs text-muted">
                        {item.prescription}
                        {item.focus ? ` · ${item.focus}` : ''}
                        {item.notes ? ` · ${item.notes}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Card className="space-y-3">
              <p className="eyebrow">Recovery snapshot</p>
              {state.recovery ? (
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted">Readiness</p>
                    <p className="mt-2 text-lg font-semibold text-white">{state.recovery.readinessScore ?? '—'}</p>
                  </div>
                  <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted">Sleep</p>
                    <p className="mt-2 text-lg font-semibold text-white">{state.recovery.sleepScore ?? '—'}</p>
                  </div>
                  <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted">HRV</p>
                    <p className="mt-2 text-lg font-semibold text-white">{state.recovery.hrvMs ?? '—'}</p>
                  </div>
                  <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted">RHR</p>
                    <p className="mt-2 text-lg font-semibold text-white">{state.recovery.restingHr ?? '—'}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm italic text-muted">No recovery data for today. Sync Oura or Apple Health.</p>
              )}
              {state.adaptive.recoveryTrend ? (
                <p className="text-xs text-muted">
                  Recovery trend over the recent window:{' '}
                  <span className="capitalize text-white">{state.adaptive.recoveryTrend.direction}</span>
                  {' '}(confidence {Math.round(state.adaptive.recoveryTrend.confidence * 100)}%, {state.adaptive.recoveryTrend.sampleCount} samples)
                </p>
              ) : null}
            </Card>
          </div>
        ) : null}
      </section>
    </main>
  );
}
