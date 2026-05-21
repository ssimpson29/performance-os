import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { getAppEnv, requireSupabaseEnv } from '@/lib/env';

const ALLOWED_NEXT_PREFIXES = ['/coach', '/longevity', '/plan', '/today', '/settings'];

function sanitizeNext(raw: string | null): string {
  if (!raw) return '/coach';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/coach';
  if (!ALLOWED_NEXT_PREFIXES.some((p) => raw === p || raw.startsWith(`${p}/`))) {
    return '/coach';
  }
  return raw;
}

/**
 * Send a Supabase magic-link OTP for sign-in.
 *
 * Why @supabase/ssr (not plain createClient): the plain client defaults to
 * the **implicit** flow — Supabase puts the access token in the URL hash
 * fragment when the user clicks the link. Hash fragments never reach the
 * server, so our /auth/callback route can't see them. Using createServerClient
 * with cookie-backed storage opts into the **PKCE** flow: Supabase issues a
 * `?code=` we can exchange server-side, and the code_verifier persists in a
 * cookie so the callback completes the exchange.
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get('email') ?? '').trim();
  const next = sanitizeNext(String(formData.get('next') ?? '/coach'));

  if (!email) {
    return NextResponse.json({ error: 'Missing email' }, { status: 400 });
  }

  const { supabaseUrl, supabasePublishableKey } = requireSupabaseEnv();
  const { appUrl } = getAppEnv();
  const baseUrl = (appUrl ?? 'http://localhost:3000').replace(/\/$/, '');
  const emailRedirectTo = `${baseUrl}/auth/callback?next=${encodeURIComponent(next)}`;

  const cookieStore = await cookies();
  type CookieToSet = { name: string; value: string; options: Record<string, unknown> };

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet: CookieToSet[]) => {
        cookiesToSet.forEach(({ name, value, options }: CookieToSet) => {
          cookieStore.set({ name, value, ...options });
        });
      },
    },
  });

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo,
      shouldCreateUser: true,
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    email,
    nextStep: 'Check your email for the magic link. Clicking it will sign you in and bring you back here.',
  });
}
