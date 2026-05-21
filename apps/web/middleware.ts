import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Supabase session refresh.
 *
 * This middleware MUST NEVER cause a 500. Any failure to refresh the
 * session is swallowed and the request is forwarded unchanged — a stale
 * session just means the next call to getAuthenticatedUser() returns null,
 * and the route surface handles that gracefully (redirect to sign-in).
 *
 * Why we need it: lib/server-auth.ts only reads cookies, never writes.
 * Without periodic refresh via setAll the access token expires (~1 hour)
 * and getAuthenticatedUser() returns null even when the refresh token is
 * valid.
 */
export async function middleware(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      '';

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.next({ request });
    }

    let response = NextResponse.next({ request });
    type CookieToSet = { name: string; value: string; options: Record<string, unknown> };

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: CookieToSet[]) => {
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

    await supabase.auth.getUser();
    return response;
  } catch (err) {
    // Log to Vercel but never block the request. A failed session refresh
    // simply means the user might be asked to sign in again — an acceptable
    // degradation compared to a 500 on every page.
    console.error('[middleware] supabase session refresh failed:', err);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|eot|map)$).*)',
  ],
};
