import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';
import { coachMoments, dailySnapshot } from '@/lib/sample-data';
import { MetricCard } from '@/components/ui/metric-card';

export default function TodayPage() {
  return (
    <main>
      <PageHero
        eyebrow="Daily brief"
        title="Know what to do today, and why."
        description="The Today surface is the app's primary operating screen: one place for planned training, fresh recovery context, and concise coaching recommendations."
        badge="Morning check-in prototype"
      />
      <section className="shell pt-4">
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.05] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-amber-300">Preview surface</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            This page is a UX preview using hardcoded sample data. It is <em>not</em> connected to
            your athlete account yet. The live places to go right now are{' '}
            <a href="/coach" className="text-brand2">/coach</a>,{' '}
            <a href="/longevity" className="text-brand2">/longevity</a>, and{' '}
            <a href="/plan/import" className="text-brand2">/plan/import</a>.
          </p>
        </div>
      </section>

      <section className="shell grid gap-6 lg:grid-cols-4">
        {dailySnapshot.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>
      <section className="shell grid gap-6 py-8 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-5">
          <div>
            <p className="eyebrow">Planned session</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Lower body strength + aerobic flush</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {['Trap-bar deadlift 4×5', 'Rear-foot split squat 3×8', 'Zone 2 bike 25 min'].map((item) => (
              <div key={item} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4 text-sm text-muted">
                {item}
              </div>
            ))}
          </div>
          <p className="text-sm leading-7 text-muted">
            In the finished product, this section would merge coach-authored intent, recent adherence, and wearable context to recommend dosage changes without rewriting the plan every day.
          </p>
        </Card>
        <Card className="space-y-4">
          <div>
            <p className="eyebrow">Coach moments</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Narrative guidance over raw data</h2>
          </div>
          <div className="space-y-3">
            {coachMoments.map((moment) => (
              <div key={moment.title} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                <h3 className="font-medium text-white">{moment.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{moment.body}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </main>
  );
}
