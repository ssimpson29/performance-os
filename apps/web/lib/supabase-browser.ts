import { createClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from '@/lib/env';

export function createBrowserSupabaseClient() {
  const { supabaseUrl, supabasePublishableKey } = requireSupabaseEnv();

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
