import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const email = process.argv[2] ?? 'scottsimpsonlax29@gmail.com';
const { data: users } = await supabase.from('users').select('*').eq('email', email).limit(1);
const user = users?.[0];
if (!user) { console.log('no user'); process.exit(0); }
console.log('USER ROW (raw, all columns)');
console.log(user);

const userId = user.id;

const [integrations, syncRuns, plannedSessions, planMatches] = await Promise.all([
  supabase.from('user_integrations').select('id, provider, status, external_user_id, created_at, updated_at, scope').eq('user_id', userId),
  supabase.from('sync_runs').select('id, provider, status, started_at, finished_at, summary').eq('user_id', userId).order('started_at', { ascending: false }).limit(10),
  supabase.from('planned_sessions').select('id, planned_date').eq('user_id', userId).limit(3),
  supabase.from('plan_workout_matches').select('id, status').eq('user_id', userId).limit(3),
]);

console.log('\nUSER_INTEGRATIONS');
console.log(integrations.data);
console.log('\nSYNC_RUNS (last 10)');
console.log(syncRuns.data);
console.log('\nPLANNED_SESSIONS sample (any?)');
console.log(plannedSessions.data, 'error:', plannedSessions.error?.message);
console.log('\nPLAN_WORKOUT_MATCHES sample (any?)');
console.log(planMatches.data, 'error:', planMatches.error?.message);

const { data: auth } = await supabase.auth.admin.getUserById(userId);
console.log('\nAUTH RECORD');
console.log({
  id: auth?.user?.id,
  email: auth?.user?.email,
  created_at: auth?.user?.created_at,
  last_sign_in_at: auth?.user?.last_sign_in_at,
  confirmed_at: auth?.user?.confirmed_at,
  email_confirmed_at: auth?.user?.email_confirmed_at,
  app_metadata: auth?.user?.app_metadata,
});
