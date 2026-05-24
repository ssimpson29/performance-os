import Link from 'next/link';

import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';

import { loadPlanView } from './plan-data';
import { buildPlanVsActualPreview, loadPlanVsActualPreview } from './plan-vs-actual-data';
import { PlanVsActualSection } from './plan-vs-actual-section';

export default async function PlanPage() {
  const view = await loadPlanView();

  if (view.kind === 'unauthenticated') {
    return (
      <main>
        <PageHero
          eyebrow="Plan"
          title="Your training plan, the race-aware engine, and the coach all hang off this surface."
          description="Sign in to import a workbook and see your live plan. Until then this is a description, not your data."
          badge="Plan preview"
        />
        <section className="shell pb-16">
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Sign in to see your plan</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                The plan page reads your imported training_plans row and runs the adaptive engine on today&apos;s state.
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Head to Integrations to send yourself a magic link. After signing in, come back here.
              </p>
            </div>
            <Link
              href="/settings/integrations"
              className="inline-flex items-center justify-center self-start rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black"
            >
              Go to Integrations
            </Link>
          </Card>
        </section>
      </main>
    );
  }

  if (view.kind === 'no-plan') {
    return (
      <main>
        <PageHero
          eyebrow="Plan"
          title="Import a training plan to get started."
          description="The plan workbook becomes the backbone of the race-aware coach. The parser handles weekly structure, phase blocks, support templates, and race context."
          badge="No plan imported yet"
        />
        <section className="shell pb-16">
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Upload an Excel training plan</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                The coach needs a plan before it can answer &ldquo;what should I do today?&rdquo;
              </h2>
            </div>
            <Link
              href="/plan/import"
              className="inline-flex items-center justify-center self-start rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black"
            >
              Import a plan
            </Link>
          </Card>
        </section>
      </main>
    );
  }

  // Plan-vs-actual section — falls back to sample data when no live data is present.
  const planVsActualPreview = await loadPlanVsActualPreview();
  const effectivePlanVsActual =
    planVsActualPreview.dataSource === 'live' ? planVsActualPreview : buildPlanVsActualPreview();

  const phaseName = view.adaptive.phasePosition?.phaseName ?? 'Phase unknown';
  const weeksToRace = view.adaptive.phasePosition?.weeksToRace;
  const planAdaptation = view.adaptive.planAdaptation;
  const recoveryTrend = view.adaptive.recoveryTrend;
  const performanceDelta = view.adaptive.performanceDelta;

  return (
    <main>
      <PageHero
        eyebrow="Training plan"
        title={view.planName}
        description={
          view.goal
            ? `Goal: ${view.goal}.${view.raceDate ? ` Race ${view.raceDate}.` : ''}`
            : `Imported plan ${view.raceDate ? `targeting ${view.raceDate}` : ''}`.trim()
        }
        badge={weeksToRace != null ? `${weeksToRace} weeks to race` : 'Plan loaded'}
      />

      <section className="shell pb-4">
        <Card className="space-y-4">
          <div>
            <p className="eyebrow">Race-aware engine — today&apos;s read</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              {phaseName}
              {view.adaptive.phasePosition?.isRaceWeek ? ' · race week' : view.adaptive.phasePosition?.isTaper ? ' · taper' : ''}
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-brand2">Plan-level adaptation</p>
              {planAdaptation ? (
                <>
                  <h3 className="mt-2 text-lg font-semibold text-white">
                    {planAdaptation.suggestion === 'raise' && `Raise next block ~${planAdaptation.magnitudePct}%`}
                    {planAdaptation.suggestion === 'hold' && 'Hold next block'}
                    {planAdaptation.suggestion === 'lower' && `Lower next block ~${Math.abs(planAdaptation.magnitudePct)}%`}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted">{planAdaptation.reason}</p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">No block-level change recommended right now.</p>
              )}
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-brand2">Recovery trend</p>
              {recoveryTrend ? (
                <>
                  <h3 className="mt-2 text-lg font-semibold capitalize text-white">{recoveryTrend.direction}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted">
                    Confidence {Math.round(recoveryTrend.confidence * 100)}% over {recoveryTrend.sampleCount} samples.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">No recent recovery samples in the database.</p>
              )}
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-brand2">Performance vs. plan</p>
              {performanceDelta ? (
                <>
                  <h3 className="mt-2 text-lg font-semibold capitalize text-white">{performanceDelta.signal}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted">
                    Volume delta {performanceDelta.volumeDelta == null ? 'n/a' : `${(performanceDelta.volumeDelta * 100).toFixed(0)}%`} ·
                    {' '}intensity delta {performanceDelta.intensityDelta == null ? 'n/a' : `${(performanceDelta.intensityDelta * 100).toFixed(0)}%`}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">No prescribed-week target supplied for delta calc.</p>
              )}
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-brand2">Fatigue state</p>
              <h3 className="mt-2 text-lg font-semibold capitalize text-white">{view.adaptive.fatigueState}</h3>
              <p className="mt-3 text-sm leading-6 text-muted">
                Weekend overload score {view.adaptive.overloadScore.toFixed(0)}.
              </p>
            </div>
          </div>
        </Card>
      </section>

      {view.weeklyStructure.length ? (() => {
        // "This week" — phase-aware 7-card grid showing the current week's
        // sessions day-by-day. Replaces the old compact-list "today + remaining
        // days" block AND the static "Weekly structure (base template)"
        // section below it (both deleted) with one unified view: the plan
        // template + adaptive overrides + cached LLM Today's Call for today.
        // Past days fade so the eye lands on today and what's ahead.
        const DAY_ORDER = [
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
          'Sunday',
        ];
        // getUTCDay returns 0=Sun, 1=Mon, ..., 6=Sat. Convert to Monday-first.
        const utcDay = new Date().getUTCDay();
        const todayIdx = utcDay === 0 ? 6 : utcDay - 1;
        const todayDayName = DAY_ORDER[todayIdx];

        const adaptationByDay = new Map(
          view.adaptive.recommendations.map((rec) => [rec.day, rec]),
        );
        const baseByDay = new Map(
          view.weeklyStructure.map((session) => [session.day, session]),
        );

        // Cached LLM-composed Today's Call (if /coach has been loaded today).
        // Renders on today's card; tomorrow → Sunday stay on the plan template.
        const cachedCall = view.todaysCall;

        // Current phase + week context for the section header. Pulled from
        // phaseBlocks[currentPhase].weeks[currentWeekIndex] so the user
        // sees the prescribed targets they're training against this week.
        const pos = view.adaptive.phasePosition;
        const currentWeek =
          pos && pos.phaseIndex >= 0
            ? view.phaseBlocks[pos.phaseIndex]?.weeks[pos.weekIndexInPhase] ?? null
            : null;
        const totalPlanWeeks = view.phaseBlocks.reduce((n, b) => n + b.weeks.length, 0);
        const currentWeekLabel =
          pos && pos.phaseIndex >= 0
            ? `Week ${pos.totalWeekIndex + 1} of ${totalPlanWeeks}`
            : null;

        return (
          <section className="shell pb-8">
            <Card className="space-y-5">
              <div>
                <p className="eyebrow">This week</p>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  {currentWeek ? (
                    <>
                      {currentWeek.mileageTarget} miles · {currentWeek.vertTarget} vert
                      {currentWeek.fuelTarget ? <> · fuel {currentWeek.fuelTarget}</> : null}
                    </>
                  ) : (
                    <>7 days of base sessions</>
                  )}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {pos?.phaseName ? (
                    <>
                      <span className="text-white">{pos.phaseName}</span>
                      {currentWeekLabel ? <> · {currentWeekLabel}</> : null}
                      {/* keyFocus is parser-derived, notes is the workbook 'Notes' column.
                          Show whichever exists; keyFocus first when both. */}
                      {currentWeek?.keyFocus
                        ? <> · {currentWeek.keyFocus}</>
                        : currentWeek?.notes
                          ? <> · {currentWeek.notes}</>
                          : null}
                      {currentWeek?.isDeload ? (
                        <span className="ml-2 rounded-full border border-amber-300/40 px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-amber-300">
                          Deload
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>Today&apos;s session is highlighted; adapted overrides are marked.</>
                  )}
                </p>
              </div>

              {/*
                Per-day target lookup from the CURRENT week's PhaseWeekTarget.
                The workbook's weekly tables (PHASE N: ... Weeks X-Y) carry
                per-week overrides for Saturday/Sunday/Thursday — these are
                what change phase-to-phase ("5h steady" Saturday in Phase 2
                vs. "2.5–3 hrs building toward 4–5 hrs" Saturday in Phase 1).
                The base weeklyStructure[] is Phase 1's daily template; for
                everything else (Mon/Tue/Wed/Fri) it stays the prescription.
              */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {DAY_ORDER.map((day) => {
                  const base = baseByDay.get(day);
                  if (!base) return null;
                  const adaptation = adaptationByDay.get(day);
                  const isToday = day === todayDayName;
                  const isPast = DAY_ORDER.indexOf(day) < todayIdx;
                  const isOverridden = adaptation?.action != null && adaptation.action !== 'keep';

                  // Per-week target wins over the Phase 1 base template
                  // for the three days the workbook explicitly overrides.
                  // Empty string = column was blank → fall back to base.
                  const weekDayTarget =
                    day === 'Saturday' ? currentWeek?.saturdayTarget?.trim() :
                    day === 'Sunday' ? currentWeek?.sundayTarget?.trim() :
                    day === 'Thursday' ? currentWeek?.thursdayTarget?.trim() :
                    null;

                  // Today + cached call gets the LLM headline; everything else
                  // shows the plan template (with an override badge if any).
                  const usingCachedCall = isToday && cachedCall != null;
                  const headline = usingCachedCall
                    ? cachedCall.headline
                    : (adaptation?.recommendedSessionType ?? base.runSession ?? '—');
                  const bodyDetails = usingCachedCall
                    ? cachedCall.details?.trim() || weekDayTarget || base.details
                    : (weekDayTarget || base.details);
                  const overrideReason = !usingCachedCall && isOverridden ? adaptation?.reason : null;

                  const cardClass = isToday
                    ? 'space-y-3 border-brand2/60 bg-brand2/[0.06]'
                    : isPast
                      ? 'space-y-3 opacity-60'
                      : 'space-y-3';

                  return (
                    <Card key={day} className={cardClass}>
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <p className={isToday ? 'text-sm font-semibold text-brand2' : 'text-sm text-brand2'}>
                            {day}
                            {isToday ? ' · today' : ''}
                          </p>
                          {isOverridden && adaptation?.action ? (
                            <span className="rounded-full border border-amber-300/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-amber-300">
                              {adaptation.action.replace(/-/g, ' ')}
                            </span>
                          ) : null}
                        </div>
                        <h3 className="mt-2 text-lg font-semibold text-white">{headline}</h3>
                      </div>

                      {bodyDetails ? (
                        <p className="text-sm leading-6 text-muted">{bodyDetails}</p>
                      ) : null}

                      {overrideReason ? (
                        <p className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-3 text-xs leading-6 text-amber-200/90">
                          {overrideReason}
                        </p>
                      ) : null}

                      {base.strengthMobility && base.strengthMobility.trim().toLowerCase() !== 'none' ? (
                        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-3 text-sm text-muted">
                          <p className="text-xs uppercase tracking-[0.18em] text-brand2/80">Support work</p>
                          <p className="mt-1 text-white">{base.strengthMobility}</p>
                          {base.exactWork && base.exactWork.trim().toLowerCase() !== 'none' ? (
                            <p className="mt-1 text-xs text-muted">{base.exactWork}</p>
                          ) : null}
                        </div>
                      ) : null}

                      {usingCachedCall ? (
                        <Link
                          href="/coach"
                          className="inline-block text-xs uppercase tracking-[0.18em] text-brand2/80 hover:text-brand2"
                        >
                          See full call →
                        </Link>
                      ) : isToday && !cachedCall ? (
                        <p className="text-xs text-muted">
                          Template shown.{' '}
                          <Link
                            href="/coach"
                            className="uppercase tracking-[0.18em] text-brand2/80 hover:text-brand2"
                          >
                            Visit Coach →
                          </Link>{' '}
                          to compose a live call.
                        </p>
                      ) : null}
                    </Card>
                  );
                })}
              </div>
            </Card>
          </section>
        );
      })() : null}

      <section className="shell pb-8">
        <Card className="space-y-4">
          <div>
            <p className="eyebrow">Full plan — phase blocks + weeks</p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              {view.phaseBlocks.length} phases · {view.phaseBlocks.reduce((n, b) => n + b.weeks.length, 0)} weeks total.
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Your full training plan, week by week. Today&apos;s week is highlighted; race week is marked. Deload weeks carry a tag.
            </p>
            {(() => {
              // Diagnostic: plan length vs. time-to-race. Phase position is
              // race-anchored (see computePhasePosition) so race week always
              // lands on the plan's last week, regardless of planStartDate.
              // This line explains *why* the highlighted week is where it is:
              // - plan length ≈ weeks-to-race + 1 → plan was sized to fit, no shift
              // - plan length > weeks-to-race + 1 → plan longer than time
              //   remaining, race anchor skipped early weeks to land in the
              //   correct phase (the common case for an imported 24-week
              //   workbook with race in 10 weeks)
              // - plan length < weeks-to-race + 1 → plan shorter than time
                //   remaining, current week clamped to 0 (rare)
              const totalPlanWeeks = view.phaseBlocks.reduce((n, b) => n + b.weeks.length, 0);
              const weeksToRace = view.adaptive.phasePosition?.weeksToRace ?? null;
              if (weeksToRace == null || totalPlanWeeks === 0) return null;
              const expectedWeeks = weeksToRace + 1; // +1 because race week itself counts
              const diff = totalPlanWeeks - expectedWeeks;
              const shiftNote =
                diff > 1 ? ` · plan is ${diff} weeks longer than time remaining — current week shifted forward to fit` :
                diff < -1 ? ` · plan is ${-diff} weeks shorter than time remaining — pinned to week 1` :
                '';
              return (
                <p className="mt-2 text-xs uppercase tracking-[0.18em] text-brand2/80">
                  Plan: {totalPlanWeeks} weeks · Race: {weeksToRace} {weeksToRace === 1 ? 'week' : 'weeks'} away · anchored from race date{shiftNote}
                </p>
              );
            })()}
          </div>
          <div className="space-y-6">
            {view.phaseBlocks.map((block, phaseIdx) => {
              const isCurrentPhase = view.adaptive.phasePosition?.phaseIndex === phaseIdx;
              return (
                <div key={`${block.phaseName}-${phaseIdx}`} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-lg font-semibold text-white">{block.phaseName}</h3>
                    <p className="text-xs uppercase tracking-[0.18em] text-brand2">
                      {block.weeks.length} weeks{isCurrentPhase ? ' · current phase' : ''}
                    </p>
                  </div>
                  <ul className="grid gap-2 md:grid-cols-2">
                    {block.weeks.map((week, weekIdx) => {
                      const isCurrentWeek =
                        isCurrentPhase &&
                        view.adaptive.phasePosition?.weekIndexInPhase === weekIdx;
                      const isRaceWeek =
                        view.adaptive.phasePosition?.isRaceWeek &&
                        isCurrentPhase &&
                        view.adaptive.phasePosition?.weekIndexInPhase === weekIdx;
                      const baseClass =
                        'rounded-2xl border p-4 text-sm leading-6 transition';
                      const stateClass = isCurrentWeek
                        ? 'border-brand2/60 bg-brand2/[0.06]'
                        : 'border-white/5 bg-white/[0.03]';
                      return (
                        <li
                          key={`${block.phaseName}-${week.weekLabel}-${weekIdx}`}
                          className={`${baseClass} ${stateClass}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-white">
                              Week {week.weekLabel}
                              {isCurrentWeek ? ' · today' : ''}
                              {isRaceWeek ? ' · RACE WEEK' : ''}
                            </p>
                            <div className="flex gap-2">
                              {week.isDeload ? (
                                <span className="rounded-full border border-amber-300/40 px-2 py-0.5 text-xs uppercase tracking-[0.18em] text-amber-300">
                                  Deload
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <p className="mt-2 text-muted">
                            <span className="text-white">{week.mileageTarget}</span> miles ·{' '}
                            <span className="text-white">{week.vertTarget}</span> vert
                            {week.fuelTarget ? (
                              <>
                                {' · '}
                                fuel <span className="text-white">{week.fuelTarget}</span>
                              </>
                            ) : null}
                          </p>
                          {week.keyFocus ? (
                            <p className="mt-1 text-xs text-muted">{week.keyFocus}</p>
                          ) : null}
                          {week.notes ? (
                            <p className="mt-1 text-xs text-muted">{week.notes}</p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      <PlanVsActualSection preview={effectivePlanVsActual} />

      {view.supportTemplates.length ? (
        <section className="shell pb-16">
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Support templates</p>
              <h2 className="mt-2 text-xl font-semibold text-white">{view.supportTemplates.length} reusable modules.</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {view.supportTemplates.map((template) => (
                <div key={template.name} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-white">{template.name}</p>
                    <span className="text-xs uppercase tracking-[0.18em] text-brand2">{template.sourceSheet}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted">{template.items.length} items.</p>
                </div>
              ))}
            </div>
          </Card>
        </section>
      ) : null}
    </main>
  );
}
