import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';
import { adaptWeeklyStructure } from '@/lib/training-plan/adaptive-coach';
import { parseTrainingPlanWorkbook } from '@/lib/training-plan/parser';

import { buildPlanVsActualPreview, loadPlanVsActualPreview } from './plan-vs-actual-data';
import { PlanVsActualSection } from './plan-vs-actual-section';

async function getImportedPlanPreview() {
  const fixturePath = join(process.cwd(), 'tests/fixtures/Swiss Alps 100.xlsx');
  const parsed = parseTrainingPlanWorkbook(readFileSync(fixturePath), 'Swiss Alps 100.xlsx');
  const adaptivePreview = adaptWeeklyStructure({
    weeklyStructure: parsed.weeklyStructure,
    completedWorkouts: [
      { day: 'Saturday', durationMinutes: 330, intensityScore: 9, loadScore: 320, sessionType: 'Long Run' },
      { day: 'Sunday', durationMinutes: 240, intensityScore: 8, loadScore: 240, sessionType: 'Mountain Long Run' },
    ],
    currentDay: 'Monday',
    recoveryScore: 46,
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
