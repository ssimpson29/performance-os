import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { getAppEnv, requireSupabaseEnv } from '@/lib/env';

const ALLOWED_NEXT_PREFIXES = ['/coach', '/longevity', '/plan', '/today', '/settings'];

function sanitizeNext(raw: string | null): string {
  if (!raw) return '/coach';
  // Only accept relative paths under known prefixes, to prevent open-redirect.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/coach';
  if (!ALLOWED_NEXT_PREFIXES.some((p) => raw === p || raw.startsWith(`${p}/`))) {
    return '/coach';
  }
  return raw;
}

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

  const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
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
