import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { requireSupabaseEnv } from '@/lib/env';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * Magic-link landing handler.
 *
 * Supabase's signInWithOtp redirects the athlete here with `?code=...` after
 * they click the link in their email. This route exchanges the code for a
 * full session — the moment that succeeds, the cookies set by the exchange
 * mean `getAuthenticatedUser()` starts returning the user, and every
 * auth-scoped surface unlocks.
 *
 * On success: redirect to `?next=...` (default `/coach`).
 * On error: redirect to `/settings/integrations?error=<message>` so the
 * athlete sees a clear failure path rather than a JSON 4xx blob.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/coach';

  if (!code) {
    return NextResponse.redirect(
      new URL('/settings/integrations?auth_error=missing_code', url.origin),
    );
  }

  let supabaseEnv: { supabaseUrl: string; supabasePublishableKey: string };
  try {
    supabaseEnv = requireSupabaseEnv();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Missing Supabase env';
    return NextResponse.redirect(
      new URL(`/settings/integrations?auth_error=${encodeURIComponent(message)}`, url.origin),
    );
  }

  const cookieStore = await cookies();
  type CookieToSet = { name: string; value: string; options: Record<string, unknown> };

  const supabase = createServerClient(supabaseEnv.supabaseUrl, supabaseEnv.supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet: CookieToSet[]) => {
        cookiesToSet.forEach(({ name, value, options }: CookieToSet) => {
          cookieStore.set({ name, value, ...options });
        });
      },
    },
  });

  const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/settings/integrations?auth_error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  // Belt-and-suspenders: ensure a public.users row exists for the just-signed-in
  // athlete. Migration 006_profile_creation.sql installs a trigger on auth.users
  // that mirrors new rows into public.users, but if the trigger ever drops out
  // or a sign-up path bypasses it, foreign-key writes to training_plans,
  // workouts, biomarker_results etc. would 500. Use the service-role client so
  // the insert isn't blocked by RLS, and ON CONFLICT so this is safe on every
  // sign-in, not just the first.
  const authUser = sessionData?.user;
  if (authUser) {
    try {
      const admin = createServerSupabaseClient();
      const displayName =
        (authUser.user_metadata as { display_name?: string } | null)?.display_name ??
        authUser.email ??
        'Athlete';
      await admin
        .from('users')
        .upsert(
          {
            id: authUser.id,
            email: authUser.email ?? null,
            display_name: displayName,
          },
          { onConflict: 'id' },
        );
    } catch (mirrorError) {
      // Don't block the redirect on a mirror failure — it will surface on the
      // next FK violation if the row truly isn't there. Just log it.
      console.error('callback: failed to upsert public.users', mirrorError);
    }
  }

  // Only allow relative paths to prevent open-redirect.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/coach';
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
