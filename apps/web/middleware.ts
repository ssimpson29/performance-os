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

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Onboarding gate: signed-in athletes who haven't completed the
    // onboarding form get redirected to /onboarding. Anonymous users
    // pass through (they hit the page's own sign-in CTA). The gate
    // skips paths that aren't user-facing app routes: /onboarding
    // itself, all /api routes (including the onboarding completion
    // endpoint), /auth (magic-link callback), and the docs route. See
    // docs/plans/2026-05-23-onboarding-and-plan-creation.md for the
    // full redirect rule.
    if (user && shouldEnforceOnboardingGate(request.nextUrl.pathname)) {
      const { data: rows } = await supabase
        .from('users')
        .select('onboarding_completed_at')
        .eq('id', user.id)
        .limit(1);
      const completedAt = (rows ?? [])[0]?.onboarding_completed_at as string | null | undefined;
      if (!completedAt) {
        const redirectUrl = new URL('/onboarding', request.url);
        return NextResponse.redirect(redirectUrl);
      }
    }

    return response;
  } catch (err) {
    // Log to Vercel but never block the request. A failed session refresh
    // simply means the user might be asked to sign in again — an acceptable
    // degradation compared to a 500 on every page.
    console.error('[middleware] supabase session refresh failed:', err);
    return NextResponse.next({ request });
  }
}

/**
 * Paths the onboarding gate must NEVER redirect:
 *   - /onboarding itself (the destination — would loop)
 *   - /account (the athlete should always be able to view + edit their
 *     own profile state, even mid-onboarding, and use the sign-out
 *     button regardless of onboarding completion)
 *   - /api/* (server endpoints — including /api/onboarding/complete)
 *   - /auth/* (magic-link callback completes auth before profile exists)
 *   - /docs (public marketing-ish surface)
 *   - / (the marketing landing page — fine to view signed-in)
 */
function shouldEnforceOnboardingGate(pathname: string): boolean {
  if (pathname === '/' || pathname === '/onboarding' || pathname === '/account') return false;
  if (pathname.startsWith('/onboarding/')) return false;
  if (pathname.startsWith('/account/')) return false;
  if (pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/auth/')) return false;
  if (pathname.startsWith('/docs')) return false;
  return true;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|eot|map)$).*)',
  ],
};
