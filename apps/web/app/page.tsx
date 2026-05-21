import Link from 'next/link';
import type { Route } from 'next';

import { Hero } from '@/components/marketing/hero';
import { Card } from '@/components/ui/card';
import { integrations } from '@/lib/site';

const surfaces: { title: string; href: Route; status: 'Live' | 'Preview'; body: string }[] = [
  {
    title: 'Coach',
    href: '/coach',
    status: 'Live',
    body: 'Talk to your Training Coach. Reads your plan, recent workouts, and recovery; surfaces today\'s call; opens a follow-up window automatically when you mention pain or strain.',
  },
  {
    title: 'Plan',
    href: '/plan/import',
    status: 'Live',
    body: 'Upload an Excel training plan. The parser extracts weekly structure, phase blocks, and race context — the race-aware adaptive engine reads it.',
  },
  {
    title: 'Longevity',
    href: '/longevity',
    status: 'Live',
    body: 'Upload a lab report image (vision LLM extracts markers) or POST structured JSON. The Longevity Guru prioritizes top levers and cross-writes a recovery-priority signal the Training Coach reads.',
  },
  {
    title: 'Today',
    href: '/today',
    status: 'Preview',
    body: 'Daily brief is a UX preview using sample data. A live signed-in surface is on the audit follow-up list.',
  },
];

export default function HomePage() {
  return (
    <main>
      <Hero />
      <section className="shell grid gap-6 pb-12 md:grid-cols-2 xl:grid-cols-4">
        {surfaces.map((surface) => (
          <Card key={surface.title} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-white">{surface.title}</h2>
              <span
                className={
                  surface.status === 'Live'
                    ? 'text-xs uppercase tracking-[0.18em] text-brand2'
                    : 'text-xs uppercase tracking-[0.18em] text-amber-300'
                }
              >
                {surface.status}
              </span>
            </div>
            <p className="text-sm leading-6 text-muted">{surface.body}</p>
            <Link href={surface.href} className="inline-flex text-sm font-medium text-brand2">
              {surface.status === 'Live' ? 'Open' : 'See preview'} →
            </Link>
          </Card>
        ))}
      </section>
      <section className="shell pb-20">
        <Card className="space-y-6">
          <div>
            <p className="eyebrow">Connected systems</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">What's wired up today.</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Each integration below is shipped end-to-end — the routes, persistence, and athlete-facing surfaces all exist. Sign in at <Link href="/settings/integrations" className="text-brand2">Integrations</Link> to start using them.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {integrations.map((item) => (
              <div key={item.name} className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-white">{item.name}</h3>
                  <span
                    className={
                      item.status === 'Live'
                        ? 'text-xs uppercase tracking-[0.18em] text-brand2'
                        : 'text-xs uppercase tracking-[0.18em] text-amber-300'
                    }
                  >
                    {item.status}
                  </span>
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
