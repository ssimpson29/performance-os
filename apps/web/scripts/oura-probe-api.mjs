// Diagnostic: call the Oura API directly with the stored access token to see
// whether the integration's token still works. Read-only — does not write.
//   node scripts/oura-probe-api.mjs [email]
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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const email = process.argv[2] ?? 'scottsimpsonlax29@gmail.com';
const { data: users } = await supabase.from('users').select('id').eq('email', email).limit(1);
const userId = users?.[0]?.id;
if (!userId) { console.log('no user for', email); process.exit(0); }

const { data: integ } = await supabase
  .from('user_integrations')
  .select('access_token_encrypted, refresh_token_encrypted, token_expires_at, status')
  .eq('user_id', userId)
  .eq('provider', 'oura')
  .limit(1);
const row = integ?.[0];
if (!row) { console.log('no oura integration'); process.exit(0); }

const token = row.access_token_encrypted;
console.log('integration status:', row.status);
console.log('token_expires_at:', row.token_expires_at, '(now:', new Date().toISOString(), ')');
console.log('access token length:', token?.length, 'refresh token present:', Boolean(row.refresh_token_encrypted));

const end = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

for (const collection of ['daily_readiness', 'sleep']) {
  const url = `https://api.ouraring.com/v2/usercollection/${collection}?start_date=${start}&end_date=${end}`;
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    console.log(`\n${collection}: HTTP ${res.status}`);
    if (!res.ok) {
      console.log('  error body:', JSON.stringify(body).slice(0, 300));
    } else {
      const data = body.data ?? [];
      console.log(`  records: ${data.length}`);
      if (data[0]) {
        const keys = Object.keys(data[0]);
        console.log('  first record day:', data[0].day, 'keys:', keys.join(', '));
        if (collection === 'sleep') {
          console.log('  sample vitals -> average_hrv:', data[0].average_hrv, 'lowest_heart_rate:', data[0].lowest_heart_rate, 'total_sleep_duration:', data[0].total_sleep_duration, 'type:', data[0].type);
        }
      }
    }
  } catch (e) {
    console.log(`\n${collection}: FETCH FAILED`, e.message);
  }
}
