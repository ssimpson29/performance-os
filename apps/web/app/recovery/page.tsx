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
