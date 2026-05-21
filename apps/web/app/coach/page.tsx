import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';

const modules = [
  {
    title: 'Daily recommendation engine',
    body: 'Summarizes the delta between plan intent, readiness, adherence, and constraints into an understandable next action.',
  },
  {
    title: 'Weekly review ritual',
    body: 'Helps athlete and coach revisit trends, adjust upcoming workload, and document rationale for plan changes.',
  },
  {
    title: 'Long-horizon guidance',
    body: 'Connects biomarkers, sleep consistency, travel, and lifestyle habits to the broader performance thesis.',
  },
];

const raceAwareSurfaces = [
  {
    title: 'Phase position',
    body: 'Where the athlete is in the race build today — phase name, week within the phase, weeks to race, and whether load raises are permitted in the current phase. Taper and race week lock the plan.',
  },
  {
    title: 'Plan-level adaptation',
    body: 'A block-level raise / hold / lower suggestion grounded in prescribed-vs-completed delta and recovery trend. Raises only fire on healthy over-performance in a non-taper / non-race-week phase. Distinct from per-day recommendations.',
  },
  {
    title: 'Recovery trend',
    body: 'Improving / stable / degrading over the recent window, with a confidence score. A degrading trend with high confidence defers Tuesday quality even without weekend overload.',
  },
  {
    title: 'Performance vs. plan',
    body: 'Over / on / under signal computed from prescribed volume and intensity vs. what the athlete actually completed. Drives adapt-up on consistent over-performance and adapt-down on lagging adherence.',
  },
];

export default function CoachPage() {
  return (
    <main>
      <PageHero
        eyebrow="Coaching system"
        title="Recommendations should feel authored, not generated."
        description="This sample route shows how the app can present intelligence as premium coaching guidance with context, confidence, and clear action steps."
        badge="Narrative UX direction"
      />
      <section className="shell grid gap-6 pb-8 lg:grid-cols-3">
        {modules.map((module) => (
          <Card key={module.title} className="space-y-3">
            <h2 className="text-xl font-semibold text-white">{module.title}</h2>
            <p className="text-sm leading-7 text-muted">{module.body}</p>
          </Card>
        ))}
      </section>

      <section className="shell pb-16">
        <Card className="space-y-4">
          <div>
            <p className="eyebrow">Training Coach — what the deterministic engine surfaces</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Four signals behind every daily recommendation.</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              The Training Coach reads four race-aware signals from the deterministic
              engine before any narrative is composed. See <code className="text-brand2">docs/two-coach-architecture.md</code>
              {' '}for the higher-level model and worked examples.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {raceAwareSurfaces.map((surface) => (
              <div key={surface.title} className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-brand2">{surface.title}</p>
                <p className="mt-3 text-sm leading-6 text-muted">{surface.body}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </main>
  );
}
