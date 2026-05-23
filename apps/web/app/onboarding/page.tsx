import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { loadAthleteProfile } from '@/lib/profile/profile-loader';

import { OnboardingFlow } from './onboarding-flow';

/**
 * /onboarding — first-time athlete flow. The middleware sends signed-in
 * athletes here when `users.onboarding_completed_at` is null; signed-out
 * athletes who somehow land here see the sign-in CTA.
 *
 * Form lives in OnboardingFlow (client). We prefill displayName from the
 * existing profile (auth-set on first sign-in) and timezone from a sane
 * default; everything else starts blank.
 */
export default async function OnboardingPage() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return (
      <main>
        <PageHero
          eyebrow="Onboarding"
          title="Sign in to set up your athlete profile."
          description="Onboarding writes your profile, injury history, and goal so the coach can plan around you. Sign in with a magic link first."
          badge="Sign in required"
        />
      </main>
    );
  }

  const supabase = createServerSupabaseClient();
  const profile = await loadAthleteProfile(supabase, user.id);

  return (
    <main>
      <PageHero
        eyebrow="Onboarding"
        title="Let's set up your athlete profile."
        description="Five quick steps. The coach uses everything here to build a plan around you. You can skip anything you don't have handy and come back to it via chat with the coach."
        badge={profile.onboardingCompletedAt ? 'Profile complete' : 'New athlete'}
      />
      <section className="shell pb-16">
        <Card className="space-y-4">
          <OnboardingFlow
            initialDisplayName={profile.displayName ?? user.email ?? ''}
            initialEmail={user.email ?? ''}
          />
        </Card>
      </section>
    </main>
  );
}
