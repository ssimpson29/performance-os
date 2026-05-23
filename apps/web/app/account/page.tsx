import Link from 'next/link';

import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';
import { loadAthleteProfile } from '@/lib/profile/profile-loader';
import { loadSoul } from '@/lib/profile/soul-loader';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

import { AccountForm } from './account-form';

/**
 * /account — single page for viewing + editing the athlete profile,
 * with a secondary collapsible "What your coaches remember about you"
 * section for the training + longevity souls. Server component loads
 * everything; client component (AccountForm) handles edits and
 * PATCH /api/profile + PATCH /api/souls calls.
 *
 * Note: middleware doesn't redirect /account to /onboarding even if
 * onboarding is incomplete — the user should always be able to view
 * their profile state. (The gate only fires on protected pages other
 * than this one + /onboarding.)
 */
export default async function AccountPage() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return (
      <main>
        <PageHero
          eyebrow="Account"
          title="Sign in to view your account."
          description="The account page shows what's on file for you — profile, athletic baseline, and the durable notes your coaches keep about you."
          badge="Sign in required"
        />
        <section className="shell pb-16">
          <Card className="space-y-4">
            <p className="text-sm text-muted">
              Head to Integrations to send yourself a magic link, then return here.
            </p>
            <Link
              href="/settings/integrations"
              className="inline-flex items-center justify-center self-start rounded-full bg-brand2 px-5 py-2 text-sm font-medium text-black"
            >
              Go to Integrations
            </Link>
          </Card>
        </section>
      </main>
    );
  }

  const supabase = createServerSupabaseClient();
  const [profile, trainingSoul, longevitySoul] = await Promise.all([
    loadAthleteProfile(supabase, user.id),
    loadSoul(supabase, user.id, 'training'),
    loadSoul(supabase, user.id, 'longevity'),
  ]);

  return (
    <main>
      <PageHero
        eyebrow="Account"
        title="Your profile, your data, your coach's memory."
        description="Edit your athletic profile, review what your coaches remember about you, and manage your sign-in."
        badge={profile.onboardingCompletedAt ? 'Active' : 'Onboarding incomplete'}
      />
      <section className="shell pb-16">
        <AccountForm
          email={user.email ?? ''}
          initialProfile={profile}
          initialTrainingSoul={trainingSoul}
          initialLongevitySoul={longevitySoul}
        />
      </section>
    </main>
  );
}
