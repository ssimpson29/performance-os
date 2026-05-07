import { Hero } from '@/components/marketing/hero';
import { Card } from '@/components/ui/card';
import { integrations } from '@/lib/site';

const surfaces = [
  {
    title: 'Today',
    body: 'Daily brief unifies readiness, planned work, and coach recommendations into a single decision surface.',
  },
  {
    title: 'Plan',
    body: 'Block, week, and session hierarchy keeps training intent visible while allowing smart adjustments.',
  },
  {
    title: 'Recovery',
    body: 'Apple Health and Oura streams become signal processing layers for sleep, HRV, resting HR, and strain.',
  },
  {
    title: 'Longevity',
    body: 'Blood work, biomarker trendlines, and evidence-informed notes make long-term health an active product surface.',
  },
];

export default function HomePage() {
  return (
    <main>
      <Hero />
      <section className="shell grid gap-6 pb-12 md:grid-cols-2 xl:grid-cols-4">
        {surfaces.map((surface) => (
          <Card key={surface.title} className="space-y-3">
            <h2 className="text-lg font-semibold text-white">{surface.title}</h2>
            <p className="text-sm leading-6 text-muted">{surface.body}</p>
          </Card>
        ))}
      </section>
      <section className="shell pb-20">
        <Card className="space-y-6">
          <div>
            <p className="eyebrow">MVP integration posture</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Start with high-signal imports, then deepen automation.</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {integrations.map((item) => (
              <div key={item.name} className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-white">{item.name}</h3>
                  <span className="text-xs uppercase tracking-[0.18em] text-brand2">{item.status}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted">{item.notes}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </main>
  );
}
