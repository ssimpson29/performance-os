import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * POST /api/auth/signout — clears the Supabase session cookies.
 *
 * Uses the SSR cookie wiring so the response carries the proper
 * `Set-Cookie` headers to expire the auth cookies. After this returns,
 * the next request from the browser will be anonymous and middleware
 * will fall through (the onboarding gate only fires for signed-in
 * users).
 *
 * Returns 200 + { ok: true } on success. Client redirects to '/'.
 */
export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    '';
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
  }

  // Next 15's cookies() is async; type it for our SSR adapter.
  const cookieStore = await cookies();
  const response = NextResponse.json({ ok: true });

  // Mirror the CookieToSet shape used by middleware.ts so strict mode is happy.
  type CookieToSet = { name: string; value: string; options: Record<string, unknown> };

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet: CookieToSet[]) => {
        cookiesToSet.forEach(({ name, value, options }: CookieToSet) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.signOut();
  return response;
}
