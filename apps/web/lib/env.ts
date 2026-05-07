function readSupabaseEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function readAppEnv() {
  return {
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  };
}

function readOuraEnv() {
  return {
    ouraClientId: process.env.OURA_CLIENT_ID,
    ouraClientSecret: process.env.OURA_CLIENT_SECRET,
  };
}

export function getSupabaseEnv() {
  return readSupabaseEnv();
}

export function getAppEnv() {
  return readAppEnv();
}

export function getOuraEnv() {
  return readOuraEnv();
}

export function hasSupabaseEnv() {
  const { supabaseUrl, supabasePublishableKey } = readSupabaseEnv();
  return Boolean(supabaseUrl && supabasePublishableKey);
}

export function hasSupabaseServiceRoleEnv() {
  const { supabaseUrl, supabaseServiceRoleKey } = readSupabaseEnv();
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

export function hasOuraEnv() {
  const { appUrl } = readAppEnv();
  const { ouraClientId, ouraClientSecret } = readOuraEnv();
  return Boolean(appUrl && ouraClientId && ouraClientSecret);
}

export function requireSupabaseEnv() {
  const { supabaseUrl, supabasePublishableKey } = readSupabaseEnv();

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      'Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }

  return {
    supabaseUrl,
    supabasePublishableKey,
  };
}

export function requireSupabaseServiceRoleEnv() {
  const { supabaseUrl, supabaseServiceRoleKey } = readSupabaseEnv();

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase server environment variables. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
  };
}

export function requireOuraEnv() {
  const { appUrl } = readAppEnv();
  const { ouraClientId, ouraClientSecret } = readOuraEnv();

  if (!appUrl || !ouraClientId || !ouraClientSecret) {
    throw new Error(
      'Missing Oura environment variables. Set NEXT_PUBLIC_APP_URL, OURA_CLIENT_ID, and OURA_CLIENT_SECRET.',
    );
  }

  return {
    appUrl,
    ouraClientId,
    ouraClientSecret,
  };
}
