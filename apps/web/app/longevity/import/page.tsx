import Link from 'next/link';

import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';
import { getAuthenticatedUser } from '@/lib/server-auth';

import { PanelImageUploader } from './panel-image-uploader';

export default async function LongevityImportPage() {
  const user = await getAuthenticatedUser();

  return (
    <main>
      <PageHero
        eyebrow="Biomarker import"
        title="Upload a lab report image. The AI extracts the panel."
        description="Vision model pulls panel date, provider, and every numeric biomarker line item. You review and correct before anything is persisted — medical data deserves a human in the loop."
        badge={user ? 'Live import' : 'Biomarker import preview'}
      />

      <section className="shell pb-16">
        {user ? (
          <Card className="space-y-6">
            <div>
              <p className="eyebrow">Two-step flow</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Upload → extract → review → save.
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Saved panels show up at <Link href="/longevity" className="text-brand2">/longevity</Link> and feed the Longevity Guru. Markers without a catalog match are skipped on save — see <code className="text-brand2">apps/web/lib/longevity/reference-ranges.ts</code> for the supported set.
              </p>
            </div>
            <PanelImageUploader />
          </Card>
        ) : (
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Sign in to import</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Biomarker panels are saved under your athlete account, so you need to sign in first.
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Head to Integrations to send yourself a magic link, then come back here.
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
