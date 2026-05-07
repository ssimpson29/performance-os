import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { getAppEnv, requireSupabaseEnv } from '@/lib/env';

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get('email') ?? '').trim();

  if (!email) {
    return NextResponse.json({ error: 'Missing email' }, { status: 400 });
  }

  const { supabaseUrl, supabasePublishableKey } = requireSupabaseEnv();
  const { appUrl } = getAppEnv();

  const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${(appUrl ?? 'http://localhost:3000').replace(/\/$/, '')}/settings/integrations`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    email,
    nextStep: 'Check your email for the magic link, then return to Integrations.',
  });
}
