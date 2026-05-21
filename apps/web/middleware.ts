import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Supabase session refresh.
 *
 * `lib/server-auth.ts` reads cookies but doesn't refresh them (no setAll).
 * Without this middleware the Supabase access token expires (~1 hour by
 * default) and `getAuthenticatedUser()` starts returning null even though
 * the refresh token is still valid — i.e., "I was signed in this morning
 * but now I'm not."
 *
 * The middleware builds a Supabase SSR client with full getAll/setAll cookie
 * wiring, calls `supabase.auth.getUser()` to either return the current user
 * or trigger a refresh, and rotates the cookies on the response. It is the
 * sibling of `/auth/callback`: callback creates the session from a magic-link
 * code, middleware keeps it alive on each request.
 *
 * Env-gated: when Supabase env is missing (local dev without keys), the
 * middleware no-ops and forwards the request unchanged.
 */
export async function middleware(request: NextRequest) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    '';

  // Bail out cleanly when the deployment isn't wired to Supabase yet.
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  type CookieToSet = { name: string; value: string; options: Record<string, unknown> };

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet: CookieToSet[]) => {
        // Mirror Supabase's recommended pattern: write the cookies onto the
        // request (so any later code in this same request sees them) AND
        // onto a freshly-constructed response (so the browser persists them).
        cookiesToSet.forEach(({ name, value }: CookieToSet) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }: CookieToSet) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // This call refreshes the session if needed and writes new cookies via
  // setAll above. We don't need the result here — the auth-scoped routes
  // call getAuthenticatedUserId() themselves.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Run on every request except static assets and image optimization.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|eot|map)$).*)',
  ],
};
