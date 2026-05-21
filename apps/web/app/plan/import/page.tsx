import Link from 'next/link';

import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';
import { getAuthenticatedUser } from '@/lib/server-auth';

import { TrainingPlanUploader } from './uploader';

export default async function PlanImportPage() {
  const user = await getAuthenticatedUser();

  return (
    <main>
      <PageHero
        eyebrow="Plan import"
        title="Upload your training plan workbook."
        description="Parses the Excel file into weekly structure, phase blocks, and support templates. Race context is persisted on the training_plans row and feeds the race-aware adaptive coach."
        badge={user ? 'Live import' : 'Plan import preview'}
      />

      <section className="shell pb-16">
        {user ? (
          <Card className="space-y-6">
            <div>
              <p className="eyebrow">Imported plan becomes your active plan</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                The most recent training_plans row drives /coach and the race-aware engine.
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Once imported, talk to the coach at <Link href="/coach" className="text-brand2">/coach</Link> for daily calls, or review the demo at <Link href="/plan" className="text-brand2">/plan</Link>.
              </p>
            </div>
            <TrainingPlanUploader />
          </Card>
        ) : (
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Sign in to import</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                The training plan is persisted under your athlete account, so you need to be signed in.
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Head to Integrations to send yourself a magic link. Once you&apos;re signed in, come back here.
              </p>
            </div>
            <Link
              href="/settings/integrations"
              className="inline-flex items-center justify-center self-start rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black"
            >
              Go to Integrations
            </Link>
          </Card>
        )}
      </section>
    </main>
  );
}
