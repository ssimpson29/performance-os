import Link from 'next/link';

import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { adaptWeeklyStructure } from '@/lib/training-plan/adaptive-coach';
import type { AdaptiveCoachResult, PhaseBlock, SupportTemplate, WeeklyStructureSession } from '@/lib/training-plan/types';

import { loadAdaptiveCoachContext, loadActiveTrainingPlan } from './coach-data';
import { buildPlanVsActualPreview, loadPlanVsActualPreview } from './plan-vs-actual-data';
import { PlanVsActualSection } from './plan-vs-actual-section';

type PlanView =
  | { kind: 'unauthenticated' }
  | { kind: 'no-plan' }
  | {
      kind: 'ready';
      planName: string;
      goal: string | null;
      raceDate: string | null;
      planStartDate: string | null;
      weeklyStructure: WeeklyStructureSession[];
      phaseBlocks: PhaseBlock[];
      supportTemplates: SupportTemplate[];
      adaptive: AdaptiveCoachResult;
    };

type TrainingPlanRow = {
  name: string | null;
  metadata: Record<string, unknown> | null;
};

async function loadPlanView(): Promise<PlanView> {
  try {
    return await loadPlanViewUnsafe();
  } catch (err) {
    console.error('loadPlanView failed:', err instanceof Error ? err.message : err);
    return { kind: 'unauthenticated' };
  }
}

async function loadPlanViewUnsafe(): Promise<PlanView> {
  const user = await getAuthenticatedUser();
  if (!user) return { kind: 'unauthenticated' };

  const supabase = createServerSupabaseClient();
  const plan = await loadActiveTrainingPlan(supabase, user.id);
  if (!plan) return { kind: 'no-plan' };

  // Pull plan name + supportTemplates directly (the data loader doesn't carry them).
  const { data: rows } = await supabase
    .from('training_plans')
    .select('name, metadata')
    .eq('id', plan.planId)
    .limit(1);
  const planRow = ((rows as TrainingPlanRow[] | null) ?? [])[0];
  const supportTemplates =
    (planRow?.metadata?.supportTemplates as SupportTemplate[] | undefined) ?? [];
  const planName = planRow?.name ?? 'Imported plan';

  // Run the race-aware engine against today's athlete state.
  const today = new Date().toISOString().slice(0, 10);
  const coachInput = await loadAdaptiveCoachContext(supabase, user.id, { today });
  const adaptive = adaptWeeklyStructure(coachInput);

  return {
    kind: 'ready',
    planName,
    goal: plan.goal,
    raceDate: plan.raceDate,
    planStartDate: plan.planStartDate,
    weeklyStructure: plan.weeklyStructure,
    phaseBlocks: plan.phaseBlocks,
    supportTemplates,
    adaptive,
  };
}

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
          {view.weeklyStructure.length ? (() => {
            // Source of truth: the imported plan's weeklyStructure (always 7
            // days). The adaptive engine only emits a recommendation when it
            // wants to override the base — so we layer adaptations on top of
            // the base plan rather than rendering only the overrides. That
            // way today and tomorrow always render, even when the engine has
            // nothing to change.
            //
            // Week starts Monday (ultra training convention — long run on
            // the weekend ends the week). From any day, show that day
            // through Sunday. Today gets highlighted in brand2.
            const DAY_ORDER = [
              'Monday',
              'Tuesday',
              'Wednesday',
              'Thursday',
              'Friday',
              'Saturday',
              'Sunday',
            ];
            // getUTCDay returns 0=Sun, 1=Mon, ..., 6=Sat. Convert to
            // Monday-first: 0=Mon, ..., 6=Sun.
            const utcDay = new Date().getUTCDay();
            const todayIdx = utcDay === 0 ? 6 : utcDay - 1;
            const todayDayName = DAY_ORDER[todayIdx];
            // Today through end-of-week (Sunday). If today is Sunday, just
            // Sunday. If today is Monday, all 7 days.
            const upcomingDays = DAY_ORDER.slice(todayIdx);

            const adaptationByDay = new Map(
              view.adaptive.recommendations.map((rec) => [rec.day, rec]),
            );
            const baseByDay = new Map(
              view.weeklyStructure.map((session) => [session.day, session]),
            );

            const rows = upcomingDays
              .map((day) => {
                const base = baseByDay.get(day);
                const adaptation = adaptationByDay.get(day);
                if (!base && !adaptation) return null;
                return {
                  day,
                  isToday: day === todayDayName,
                  baseSession: base?.runSession ?? null,
                  baseDetails: base?.details ?? null,
                  recommendedSession: adaptation?.recommendedSessionType ?? null,
                  action: adaptation?.action ?? null,
                  reason: adaptation?.reason ?? null,
                };
              })
              .filter((r): r is NonNullable<typeof r> => r !== null);

            if (rows.length === 0) return null;

            return (
              <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-brand2">
                  This week — today + remaining days
                </p>
                <ul className="mt-2 space-y-2 text-sm text-muted">
                  {rows.map((row) => {
                    // Choose the headline session: adaptation wins when it
                    // changes things; otherwise show the base session.
                    const headlineSession =
                      row.recommendedSession ?? row.baseSession ?? '—';
                    const isOverridden =
                      row.action != null && row.action !== 'keep';
                    return (
                      <li
                        key={row.day}
                        className={
                          row.isToday ? 'rounded-lg bg-brand2/10 px-2 py-1' : ''
                        }
                      >
                        <span
                          className={
                            row.isToday
                              ? 'font-semibold text-brand2'
                              : 'text-white'
                          }
                        >
                          {row.day}
                          {row.isToday ? ' (today)' : ''}:
                        </span>{' '}
                        {headlineSession}
                        {isOverridden && row.action ? (
                          <>
                            {' — '}
                            <span className="text-xs uppercase tracking-[0.18em] text-amber-300">
                              {row.action}
                            </span>
                          </>
                        ) : null}
                        {row.reason ? (
                          <>
                            {' '}
                            <span className="text-xs text-muted">
                              {row.reason}
                            </span>
                          </>
                        ) : row.baseDetails ? (
                          <>
                            {' '}
                            <span className="text-xs text-muted">
                              {row.baseDetails}
                            </span>
                          </>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })() : null}
        </Card>
      </section>

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

      <section className="shell grid gap-6 pb-8 lg:grid-cols-3">
        <Card className="space-y-4 lg:col-span-3">
          <div>
            <p className="eyebrow">Weekly structure (base template)</p>
            <h2 className="mt-2 text-xl font-semibold text-white">7 days, base sessions</h2>
            <p className="mt-2 text-sm text-muted">
              The athlete-facing weekly template the plan adapts from. The race-aware engine adjusts specific days (intensity, downgrades) based on recent recovery / weekend load.
            </p>
          </div>
        </Card>

        {view.weeklyStructure.map((session) => (
          <Card key={session.day} className="space-y-4">
            <div>
              <p className="text-sm text-brand2">{session.day}</p>
              <h2 className="mt-2 text-xl font-semibold text-white">{session.runSession}</h2>
            </div>
            <p className="text-sm leading-6 text-muted">{session.details}</p>
            {session.strengthMobility ? (
              <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4 text-sm text-muted">
                <p className="font-medium text-white">Support work</p>
                <p className="mt-2">{session.strengthMobility}</p>
              </div>
            ) : null}
          </Card>
        ))}
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
