import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';

const docs = [
  {
    title: 'Product strategy',
    body: 'See docs/product-strategy.md for positioning, UX principles, and the front-facing coach + longevity thesis.',
  },
  {
    title: 'Implementation plan',
    body: 'See docs/implementation-plan.md for the phased execution path after the scaffold.',
  },
  {
    title: 'Supabase starter',
    body: 'See supabase/migrations/001_extensions_and_enums.sql through 006_profile_creation.sql for the current schema baseline.',
  },
];

export default function DocsPage() {
  return (
    <main>
      <PageHero
        eyebrow="Repository guide"
        title="This scaffold includes product thinking, not just folders."
        description="The in-app docs route mirrors key repository documents so stakeholders can quickly understand the framing and implementation direction."
        badge="Repo companion"
      />
      <section className="shell grid gap-6 pb-16 md:grid-cols-3">
        {docs.map((doc) => (
          <Card key={doc.title} className="space-y-3">
            <h2 className="text-xl font-semibold text-white">{doc.title}</h2>
            <p className="text-sm leading-7 text-muted">{doc.body}</p>
          </Card>
        ))}
      </section>
    </main>
  );
}
