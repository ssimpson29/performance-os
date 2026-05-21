import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Link from 'next/link';

import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';
import { adaptWeeklyStructure } from '@/lib/training-plan/adaptive-coach';
import { parseTrainingPlanWorkbook } from '@/lib/training-plan/parser';

import { buildPlanVsActualPreview, loadPlanVsActualPreview } from './plan-vs-actual-data';
import { PlanVsActualSection } from './plan-vs-actual-section';

async function getImportedPlanPreview() {
  const fixturePath = join(process.cwd(), 'tests/fixtures/Swiss Alps 100.xlsx');
  const parsed = parseTrainingPlanWorkbook(readFileSync(fixturePath), 'Swiss Alps 100.xlsx');
  // Demo inputs: an athlete 12 weeks into the plan with a healthy
  // over-performing trend (recovery stable in mid-70s, prescribed-vs-completed
  // delta positive). This exercises the race-aware adapt-up logic so the
  // page demonstrates the full engine, not just the legacy weekend-overload
  // heuristic.
  const demoToday = '2026-04-27'; // ~14 weeks into the plan, race week 26 is 2026-08-03
  const demoRecoveryHistory = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-04-${String(18 + i).padStart(2, '0')}`,
    score: 76 + (i % 3),
  }));
  const adaptivePreview = adaptWeeklyStructure({
    weeklyStructure: parsed.weeklyStructure,
    completedWorkouts: [
      { day: 'Saturday', durationMinutes: 210, intensityScore: 6, loadScore: 180, sessionType: 'Long Run' },
      { day: 'Sunday', durationMinutes: 150, intensityScore: 5, loadScore: 120, sessionType: 'Aerobic Recovery' },
    ],
    currentDay: 'Monday',
    recoveryScore: 78,
    today: demoToday,
    planStartDate: '2026-02-02',
    raceDate: '2026-08-07',
    phaseBlocks: parsed.phaseBlocks,
    prescribedWeek: { volumeTarget: 280, intensityTarget: 5 },
    recoveryHistory: demoRecoveryHistory,
  });

  const planVsActualPreview = await loadPlanVsActualPreview();

  return { parsed, adaptivePreview, planVsActualPreview: planVsActualPreview.dataSource === 'live' ? planVsActualPreview : buildPlanVsActualPreview() };
}

export default async function PlanPage() {
  const { parsed, adaptivePreview, planVsActualPreview } = await getImportedPlanPreview();

  return (
    <main>
      <PageHero
        eyebrow="Training architecture"
        title="Programming that stays legible from quarter to workout."
        description="The coach uses weekly structure as the base, then adapts Monday and Tuesday based on what actually happened over the weekend and how recovered the athlete is."
        badge="Excel import + adaptive coaching"
      />
      <section className="shell pb-4">
        <Card className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="eyebrow">Have your own training plan?</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Upload an Excel workbook to use the coach with your plan.</h2>
            <p className="mt-1 text-sm text-muted">Parses weekly structure, phase blocks, and support templates. Sign-in required.</p>
          </div>
          <Link
            href="/plan/import"
            className="inline-flex items-center self-start rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black md:self-auto"
          >
            Import your plan
          </Link>
        </Card>
      </section>
      <section className="shell grid gap-6 pb-8 lg:grid-cols-3">
        <Card className="space-y-4 lg:col-span-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Imported workbook preview</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">{parsed.planName}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                {parsed.phaseBlocks.length} phases, {parsed.weeklyStructure.length} weekly anchor sessions, and {parsed.supportTemplates.length} support templates parsed from the uploaded workbook.
              </p>
            </div>
            <span className="text-sm text-brand2">Weekly structure is the base layer</span>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {parsed.phaseBlocks.slice(0, 3).map((block) => (
              <div key={block.phaseName} className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-brand2">{block.weeks.length} weeks</p>
                <h3 className="mt-2 text-lg font-semibold text-white">{block.phaseName}</h3>
                <p className="mt-3 text-sm leading-6 text-muted">
                  First target: {block.weeks[0]?.mileageTarget} miles / {block.weeks[0]?.vertTarget} vert / fuel {block.weeks[0]?.fuelTarget}
                </p>
              </div>
            ))}
          </div>
        </Card>

        {parsed.weeklyStructure.map((session) => (
          <Card key={session.day} className="space-y-4">
            <div>
              <p className="text-sm text-brand2">{session.day}</p>
              <h2 className="mt-2 text-xl font-semibold text-white">{session.runSession}</h2>
            </div>
            <p className="text-sm leading-6 text-muted">{session.details}</p>
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4 text-sm text-muted">
              <p className="font-medium text-white">Support work</p>
              <p className="mt-2">{session.strengthMobility}</p>
            </div>
          </Card>
        ))}
      </section>

      <PlanVsActualSection preview={planVsActualPreview} />

      <section className="shell pb-8">
        <Card className="space-y-4">
          <div>
            <p className="eyebrow">Race-aware engine</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Phase position and plan-level adaptation.</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              The deterministic coach reads the active plan, recent workouts, and recovery
              trend to know where the athlete is in the race build and whether the next
              block should hold, raise, or lower its load.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-brand2">Phase position</p>
              {adaptivePreview.phasePosition ? (
                <>
                  <h3 className="mt-2 text-lg font-semibold text-white">{adaptivePreview.phasePosition.phaseName ?? 'Unknown phase'}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted">
                    Week {adaptivePreview.phasePosition.weekIndexInPhase + 1} of phase ·
                    {' '}{adaptivePreview.phasePosition.weeksToRace} weeks to race ·
                    {' '}{adaptivePreview.phasePosition.isRaceWeek ? 'race week' : adaptivePreview.phasePosition.isTaper ? 'taper' : adaptivePreview.phasePosition.raiseAllowed ? 'raises allowed' : 'raises locked'}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">Phase data unavailable.</p>
              )}
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-brand2">Plan-level adaptation</p>
              {adaptivePreview.planAdaptation ? (
                <>
                  <h3 className="mt-2 text-lg font-semibold text-white">
                    {adaptivePreview.planAdaptation.suggestion === 'raise' && `Raise next block ~${adaptivePreview.planAdaptation.magnitudePct}%`}
                    {adaptivePreview.planAdaptation.suggestion === 'hold' && 'Hold next block'}
                    {adaptivePreview.planAdaptation.suggestion === 'lower' && `Lower next block ~${Math.abs(adaptivePreview.planAdaptation.magnitudePct)}%`}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted">{adaptivePreview.planAdaptation.reason}</p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">No block-level change recommended right now.</p>
              )}
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-brand2">Recovery trend</p>
              {adaptivePreview.recoveryTrend ? (
                <>
                  <h3 className="mt-2 text-lg font-semibold text-white capitalize">{adaptivePreview.recoveryTrend.direction}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted">
                    Confidence {Math.round(adaptivePreview.recoveryTrend.confidence * 100)}% over {adaptivePreview.recoveryTrend.sampleCount} samples.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">No recovery history supplied.</p>
              )}
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-brand2">Performance vs. plan</p>
              {adaptivePreview.performanceDelta ? (
                <>
                  <h3 className="mt-2 text-lg font-semibold text-white capitalize">{adaptivePreview.performanceDelta.signal}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted">
                    Volume delta {adaptivePreview.performanceDelta.volumeDelta == null ? 'n/a' : `${(adaptivePreview.performanceDelta.volumeDelta * 100).toFixed(0)}%`} ·
                    {' '}intensity delta {adaptivePreview.performanceDelta.intensityDelta == null ? 'n/a' : `${(adaptivePreview.performanceDelta.intensityDelta * 100).toFixed(0)}%`}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">No prescribed week supplied.</p>
              )}
            </div>
          </div>
        </Card>
      </section>

      <section className="shell grid gap-6 pb-16 lg:grid-cols-2">
        <Card className="space-y-4">
          <div>
            <p className="eyebrow">Adaptive coach example</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Weekend overload changes Monday and Tuesday.</h2>
          </div>
          <p className="text-sm leading-6 text-muted">
            After two very long, intense back-to-back weekend sessions, the coach downgrades Monday and defers Tuesday quality rather than blindly following the base sheet.
          </p>
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4 text-sm text-muted">
            <p className="font-medium text-white">Fatigue state: {adaptivePreview.fatigueState}</p>
            <p className="mt-2">Overload score: {adaptivePreview.overloadScore.toFixed(0)}</p>
          </div>
          <div className="space-y-3">
            {adaptivePreview.recommendations.map((recommendation) => (
              <div key={recommendation.day} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-white">{recommendation.day}</p>
                  <span className="text-xs uppercase tracking-[0.18em] text-brand2">{recommendation.action}</span>
                </div>
                <p className="mt-2 text-sm text-muted">
                  Base: {recommendation.baseSessionType} → Recommended: {recommendation.recommendedSessionType}
                </p>
                <p className="mt-2 text-sm text-muted">{recommendation.reason}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="space-y-4">
          <div>
            <p className="eyebrow">Support templates</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Accessory work is preserved as reusable modules.</h2>
          </div>
          <div className="space-y-3">
            {parsed.supportTemplates.map((template) => (
              <div key={template.name} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-white">{template.name}</p>
                  <span className="text-xs uppercase tracking-[0.18em] text-brand2">{template.sourceSheet}</span>
                </div>
                <p className="mt-2 text-sm text-muted">{template.items.length} movements or protocol items imported.</p>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </main>
  );
}
