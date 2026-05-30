// Is the Oura connection actually updating? Shows the integration row,
// recent sync runs, and the latest recovery_daily rows by source.
//   node scripts/oura-status.mjs [email]
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
console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);

const email = process.argv[2] ?? 'scottsimpsonlax29@gmail.com';
const { data: users } = await supabase.from('users').select('id').eq('email', email).limit(1);
const userId = users?.[0]?.id;
if (!userId) { console.log('no user for', email); process.exit(0); }
console.log('user:', email, userId, '\n');

const integrations = await supabase
  .from('user_integrations')
  .select('id, provider, status, external_user_id, token_expires_at, last_synced_at, created_at, updated_at')
  .eq('user_id', userId);
console.log('USER_INTEGRATIONS', integrations.error ? 'ERROR: ' + integrations.error.message : '');
console.table(integrations.data ?? []);

const sync = await supabase
  .from('sync_runs')
  .select('provider, status, started_at, finished_at, records_processed, error_message')
  .eq('user_id', userId)
  .order('started_at', { ascending: false })
  .limit(10);
console.log('\nSYNC_RUNS (last 10)', sync.error ? 'ERROR: ' + sync.error.message : '');
console.table(sync.data ?? []);

const recovery = await supabase
  .from('recovery_daily')
  .select('day, source, readiness_score, sleep_score, hrv_ms, resting_hr, flag, updated_at')
  .eq('user_id', userId)
  .order('day', { ascending: false })
  .limit(10);
console.log('\nRECOVERY_DAILY (last 10)', recovery.error ? 'ERROR: ' + recovery.error.message : '');
console.table(recovery.data ?? []);

const ouraCount = await supabase
  .from('recovery_daily')
  .select('id', { count: 'exact', head: true })
  .eq('user_id', userId)
  .eq('source', 'oura');
console.log('\nTotal Oura recovery_daily rows:', ouraCount.count, ouraCount.error ? 'ERROR: ' + ouraCount.error.message : '');
