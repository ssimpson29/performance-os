// One-shot manual Oura sync mirroring lib/oura/recovery-sync.ts. Backfills
// recovery_daily for the last N days using the stored access token, then
// bumps last_synced_at. Idempotent (upsert on user_id,source,day).
//   node scripts/oura-sync-once.mjs [email] [days]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const email = process.argv[2] ?? 'scottsimpsonlax29@gmail.com';
const days = Number(process.argv[3] ?? 35);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : v != null && !Number.isNaN(Number(v)) ? Number(v) : null);
const int = (v) => { const n = num(v); return n === null ? null : Math.round(n); };
const minsFromSecs = (v) => { const n = num(v); return n === null ? null : Math.round(n / 60); };
const isDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const flagFor = (s) => (s === null ? null : s >= 85 ? 'green' : s >= 70 ? 'yellow' : 'red');

const { data: users } = await supabase.from('users').select('id').eq('email', email).limit(1);
const userId = users?.[0]?.id;
if (!userId) { console.log('no user'); process.exit(1); }
const { data: integ } = await supabase
  .from('user_integrations')
  .select('id, access_token_encrypted')
  .eq('user_id', userId).eq('provider', 'oura').limit(1);
const integration = integ?.[0];
const token = integration?.access_token_encrypted;
if (!token) { console.log('no oura token'); process.exit(1); }

const end = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

async function fetchCollection(collection) {
  const out = [];
  let nextToken = null;
  do {
    const params = new URLSearchParams({ start_date: start, end_date: end });
    if (nextToken) params.set('next_token', nextToken);
    const res = await fetch(`https://api.ouraring.com/v2/usercollection/${collection}?${params}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`${collection} ${res.status}: ${body.message ?? body.error ?? 'fetch failed'}`);
    out.push(...(body.data ?? []));
    nextToken = body.next_token ?? null;
  } while (nextToken);
  return out;
}

const [readiness, dailySleep, activity, sleep] = await Promise.all([
  fetchCollection('daily_readiness'),
  fetchCollection('daily_sleep'),
  fetchCollection('daily_activity'),
  fetchCollection('sleep'),
]);
console.log(`fetched: readiness=${readiness.length} daily_sleep=${dailySleep.length} activity=${activity.length} sleep=${sleep.length}`);

const byDay = new Map();
const slot = (d) => byDay.get(d) ?? { readiness: null, sleep: null, activity: null, detailedSleep: null };
for (const r of readiness) if (isDay(r.day)) byDay.set(r.day, { ...slot(r.day), readiness: r });
for (const r of dailySleep) if (isDay(r.day)) byDay.set(r.day, { ...slot(r.day), sleep: r });
for (const r of activity) if (isDay(r.day)) byDay.set(r.day, { ...slot(r.day), activity: r });
for (const r of sleep) {
  if (!isDay(r.day) || r.type === 'deleted') continue;
  const cur = slot(r.day);
  const incoming = num(r.total_sleep_duration) ?? 0;
  const existing = num(cur.detailedSleep?.total_sleep_duration) ?? -1;
  if (!cur.detailedSleep || incoming > existing) cur.detailedSleep = r;
  byDay.set(r.day, cur);
}

const rows = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, r]) => {
  const v = r.detailedSleep ?? r.sleep;
  const rs = int(r.readiness?.score);
  const ss = int(r.sleep?.score);
  return {
    user_id: userId, source: 'oura', day,
    readiness_score: rs, sleep_score: ss, activity_score: int(r.activity?.score),
    sleep_duration_minutes: minsFromSecs(r.detailedSleep?.total_sleep_duration ?? r.sleep?.total_sleep_duration),
    hrv_ms: num(v?.average_hrv) ?? num(r.readiness?.average_hrv) ?? num(r.readiness?.hrv_ms),
    resting_hr: num(v?.lowest_heart_rate) ?? num(v?.resting_heart_rate) ?? num(r.readiness?.resting_heart_rate),
    body_temperature_delta: num(r.readiness?.temperature_deviation) ?? num(r.readiness?.body_temperature_delta) ?? num(v?.temperature_deviation),
    respiratory_rate: num(v?.average_breath) ?? num(v?.respiratory_rate),
    strain_score: num(r.activity?.strain) ?? num(r.activity?.strain_score),
    flag: flagFor(rs ?? ss),
    metadata: { oura: { readiness: r.readiness, sleep: r.sleep, activity: r.activity, detailedSleep: r.detailedSleep } },
  };
});

const { error } = await supabase.from('recovery_daily').upsert(rows, { onConflict: 'user_id,source,day' });
if (error) { console.log('UPSERT FAILED:', error.message); process.exit(1); }
await supabase.from('user_integrations').update({ last_synced_at: new Date().toISOString() }).eq('id', integration.id);
console.log(`upserted ${rows.length} recovery_daily rows (${rows[0]?.day} .. ${rows.at(-1)?.day})`);
const withHrv = rows.filter((r) => r.hrv_ms != null).length;
console.log(`rows with hrv_ms: ${withHrv}/${rows.length}; newest:`, rows.at(-1));
