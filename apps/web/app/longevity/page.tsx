import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';
import { biomarkers } from '@/lib/sample-data';

export default function LongevityPage() {
  return (
    <main>
      <PageHero
        eyebrow="Longevity review"
        title="Make biomarkers actionable without losing nuance."
        description="This surface frames blood work as longitudinal context for training, recovery, and lifestyle decisions. It should encourage disciplined follow-up rather than one-off biohacking."
        badge="Labs + evidence notes"
      />
      <section className="shell grid gap-6 pb-16 lg:grid-cols-[0.95fr_1.05fr]">
        <Card className="space-y-4">
          <div>
            <p className="eyebrow">Flagged biomarkers</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Recent panel interpretation</h2>
          </div>
          <div className="space-y-3">
            {biomarkers.map((item) => (
              <div key={item.name} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-white">{item.name}</h3>
                  <span className="text-sm text-brand2">{item.status}</span>
                </div>
                <p className="mt-2 text-sm text-white">{item.latest}</p>
                <p className="mt-2 text-sm leading-6 text-muted">{item.note}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card className="space-y-4">
          <div>
            <p className="eyebrow">Why this matters</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">A coaching system with a longer horizon.</h2>
          </div>
          <p className="text-sm leading-7 text-muted">
            The product thesis is that high performers want training performance and long-term health managed in the same operating context. A hard block, poor sleep run, and drifting ferritin should not live in separate apps with separate narratives.
          </p>
          <p className="text-sm leading-7 text-muted">
            Future versions can attach research summaries, physician escalation workflows, lab upload OCR, and coach annotations while keeping a careful boundary around medical advice.
          </p>
        </Card>
      </section>
    </main>
  );
}
