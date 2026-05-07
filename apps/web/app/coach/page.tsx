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

export default function CoachPage() {
  return (
    <main>
      <PageHero
        eyebrow="Coaching system"
        title="Recommendations should feel authored, not generated."
        description="This sample route shows how the app can present intelligence as premium coaching guidance with context, confidence, and clear action steps."
        badge="Narrative UX direction"
      />
      <section className="shell grid gap-6 pb-16 lg:grid-cols-3">
        {modules.map((module) => (
          <Card key={module.title} className="space-y-3">
            <h2 className="text-xl font-semibold text-white">{module.title}</h2>
            <p className="text-sm leading-7 text-muted">{module.body}</p>
          </Card>
        ))}
      </section>
    </main>
  );
}
