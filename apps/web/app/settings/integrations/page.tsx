import { PageHero } from '@/components/layout/page-hero';
import { Card } from '@/components/ui/card';
import { OuraUserBindingCard } from '@/components/integrations/oura-user-binding-card';
import { SignInCard } from '@/components/integrations/sign-in-card';
import { buildAppleHealthPushUrl } from '@/lib/apple-health/automation';
import { getSupabaseEnv, hasSupabaseEnv, hasSupabaseServiceRoleEnv } from '@/lib/env';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { integrations } from '@/lib/site';

/**
 * Resolve the athlete from the real auth cookie (lib/server-auth), not from
 * 'latest user in the users table'. Earlier versions of this page used a
 * service-role shortcut that returned the most-recently-created row — which
 * made the page think someone was signed in even when no one was, hiding the
 * SignInCard. Use real auth so the sign-in UI shows up when (and only when)
 * the visitor is unauthenticated.
 */
async function resolveCurrentUser(): Promise<{ id: string; email: string } | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? '' };
}

export default async function IntegrationsPage() {
  const supabaseReady = hasSupabaseEnv();
  const supabaseServerReady = hasSupabaseServiceRoleEnv();
  const { supabaseUrl } = getSupabaseEnv();
  const projectHost = supabaseUrl ? new URL(supabaseUrl).host : null;
  const currentUser = await resolveCurrentUser();
  const appleHealthPushUrl = currentUser ? buildAppleHealthPushUrl(currentUser.id) : null;

  return (
    <main>
      <PageHero
        eyebrow="Integrations"
        title="Connect the systems that already know the athlete."
        description="MVP connectivity focuses on dependable imports and a clean data contract. Reliability matters more than chasing every source at launch."
        badge="Settings / Integrations"
      />
      <section className="shell grid gap-6 pb-8 md:grid-cols-2">
        {currentUser ? null : (
          <div className="md:col-span-2">
            <SignInCard />
          </div>
        )}
        <Card className="space-y-4 md:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Supabase project</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Base connection {supabaseReady ? 'configured' : 'not configured'}</h2>
            </div>
            <span className="text-sm text-brand2">{supabaseReady ? 'Ready for app wiring' : 'Missing env'}</span>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted">Project host</p>
              <p className="mt-2 text-sm text-white">{projectHost ?? 'Not set'}</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted">Browser client</p>
              <p className="mt-2 text-sm text-white">{supabaseReady ? 'Configured' : 'Missing public env'}</p>
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted">Server client</p>
              <p className="mt-2 text-sm text-white">{supabaseServerReady ? 'Configured' : 'Missing service role env'}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted">Next unlocks</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              Browser auth, protected route handlers, Apple Health workout imports, and Oura token persistence can now be wired against the configured project. Applying SQL migrations still requires either a database connection string or Supabase CLI login context.
            </p>
          </div>
        </Card>

        {currentUser ? (
          <Card className="space-y-4">
            <div>
              <p className="eyebrow">Oura setup</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Connect Oura to the signed-in athlete.</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Recovery, sleep, and readiness sync into Supabase via OAuth once Oura is bound to your athlete profile.
              </p>
            </div>
            <OuraUserBindingCard currentUser={currentUser} />
          </Card>
        ) : null}

        <Card className="space-y-4">
          <div>
            <p className="eyebrow">Apple Health import</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Recurring workout updates are now supported.</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              One-off XML uploads still work, but the better path is an iPhone Shortcut that POSTs workout JSON to a signed endpoint two or more times per day. Re-sending the same workout is safe because ingestion upserts on source + external ID.
            </p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5 text-sm text-muted">
            <p className="font-medium text-white">Shortcut push endpoint</p>
            {appleHealthPushUrl ? (
              <>
                <p className="mt-2 break-all text-white">{appleHealthPushUrl}</p>
                <p className="mt-3">
                  Treat this URL like a secret. Configure an iPhone Shortcut or automation to POST JSON with a <code>workouts</code> array to this endpoint a couple of times per day.
                </p>
              </>
            ) : (
              <p className="mt-2">Sign in first so the app can bind a user-specific push URL.</p>
            )}
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5 text-sm text-muted">
            <p className="font-medium text-white">Shortcut JSON shape</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-white">{`{
  "workouts": [
    {
      "externalId": "optional-stable-id",
      "workoutType": "Outdoor Run",
      "startedAt": "2026-05-05T14:00:00.000Z",
      "endedAt": "2026-05-05T15:05:00.000Z",
      "durationSeconds": 3900,
      "distanceMeters": 12000,
      "energyKcal": 850,
      "avgHeartRate": 148,
      "maxHeartRate": 171
    }
  ]
}`}</pre>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5 text-sm text-muted">
            <p className="font-medium text-white">One-off fallback</p>
            <p className="mt-2">
              POST Apple Health export XML files to <code>/api/imports/apple-health</code> with a <code>userId</code> and <code>file</code> when you want a manual backfill.
            </p>
          </div>
        </Card>

        {integrations.map((item) => (
          <Card key={item.name} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-white">{item.name}</h2>
              <span className="text-sm text-brand2">{item.status}</span>
            </div>
            <p className="text-sm leading-7 text-muted">{item.notes}</p>
          </Card>
        ))}
      </section>
    </main>
  );
}
