import { createClient } from '@supabase/supabase-js';
import { requireSupabaseServiceRoleEnv } from '@/lib/env';

export function createServerSupabaseClient() {
  const { supabaseUrl, supabaseServiceRoleKey } = requireSupabaseServiceRoleEnv();

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
