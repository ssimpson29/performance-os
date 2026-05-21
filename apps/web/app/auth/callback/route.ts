import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { requireSupabaseEnv } from '@/lib/env';

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

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/settings/integrations?auth_error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  // Only allow relative paths to prevent open-redirect.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/coach';
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
