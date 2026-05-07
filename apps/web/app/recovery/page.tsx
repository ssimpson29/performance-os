import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';

const streams = [
  ['Sleep timing + duration', 'Apple Health and Oura comparisons surface rhythm consistency and debt accumulation.'],
  ['HRV + resting HR', 'Baseline-aware trend analysis frames whether load is being absorbed or if a pivot is warranted.'],
  ['Readiness overlays', 'Daily scores become interpretable only when shown beside planned intensity and recent strain.'],
  ['Subjective check-ins', 'Mood, soreness, libido, and motivation complete the picture when sensors disagree.'],
];

export default function RecoveryPage() {
  return (
    <main>
      <PageHero
        eyebrow="Recovery intelligence"
        title="Turn wearable streams into usable decisions."
        description="The recovery layer should feel less like a data exhaust dashboard and more like a coach who notices when your physiology and your plan stop matching."
        badge="Apple Health first, Oura next"
      />
      <section className="shell grid gap-6 pb-16 md:grid-cols-2">
        {streams.map(([title, body]) => (
          <Card key={title} className="space-y-3">
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            <p className="text-sm leading-7 text-muted">{body}</p>
          </Card>
        ))}
      </section>
    </main>
  );
}
