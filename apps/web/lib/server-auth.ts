import { cookies } from 'next/headers';
import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';

import { requireSupabaseEnv } from '@/lib/env';

/**
 * Build a per-request Supabase client wired to the incoming request cookies.
 *
 * Returns a read-only-ish server client: `setAll` is intentionally omitted
 * because route handlers don't need session refresh during a single request.
 * If we later need to rotate session cookies on read, wire `setAll` to push
 * Set-Cookie headers onto the response.
 */
export async function createRequestSupabaseClient(): Promise<SupabaseClient> {
  const { supabaseUrl, supabasePublishableKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  const cookieAdapter: CookieMethodsServer = {
    getAll: () =>
      cookieStore.getAll().map(({ name, value }) => ({ name, value })),
  };

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: cookieAdapter,
  });
}

/**
 * Resolve the currently authenticated Supabase user from request cookies, or
 * null if there is no valid session. Never throws on the "not signed in" path;
 * only throws if Supabase env vars are missing (deployment misconfiguration).
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  // Catch every failure mode (missing env, network error, malformed cookies,
  // invalid API key) and return null so the caller treats the visitor as
  // unauthenticated. The page renders the sign-in CTA instead of a 500.
  try {
    const supabase = await createRequestSupabaseClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      return null;
    }
    return data.user;
  } catch (err) {
    // Soft-fail; the unauth path is always the safe fallback. Log so
    // Vercel function logs still capture the misconfiguration.
    console.error('getAuthenticatedUser failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Convenience: the authenticated athlete id, or null if no session.
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const user = await getAuthenticatedUser();
  return user?.id ?? null;
}
