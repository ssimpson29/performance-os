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

const email = process.argv[2] ?? 'scott@spsimpson.net';
const today = new Date().toISOString().slice(0, 10);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function selectUser(columns) {
  return supabase.from('users').select(columns).eq('email', email).limit(1);
}
let userResp = await selectUser('id, email, display_name, primary_goal, onboarding_completed_at');
let missingOnboardingCols = false;
if (userResp.error && /column .* does not exist/i.test(userResp.error.message)) {
  missingOnboardingCols = true;
  console.log('WARNING: onboarding columns from migration 009 not present on this Supabase project');
  console.log('  -> ' + userResp.error.message);
  userResp = await selectUser('id, email, display_name');
}
if (userResp.error) throw userResp.error;
const users = userResp.data;
if (!users || users.length === 0) {
  console.log(`No user found for ${email}`);
  process.exit(0);
}
const user = users[0];
const userId = user.id;
console.log('USER');
console.log(user);

const [
  biomarkerCount,
  panels,
  recovery,
  todayRows,
  recentRows,
  plans,
  workouts,
  healthEvents,
] = await Promise.all([
  supabase.from('biomarker_results').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  supabase
    .from('lab_panels')
    .select('id, panel_date, provider, panel_name')
    .eq('user_id', userId)
    .order('panel_date', { ascending: false })
    .limit(5),
  supabase
    .from('recovery_daily')
    .select('day, source, readiness_score, sleep_score, hrv_ms, resting_hr, flag')
    .eq('user_id', userId)
    .order('day', { ascending: false })
    .limit(7),
  supabase
    .from('daily_summaries')
    .select('day, readiness_flag, training_recommendation, longevity_priority, summary')
    .eq('user_id', userId)
    .eq('day', today),
  supabase
    .from('daily_summaries')
    .select('day, training_recommendation, longevity_priority, summary')
    .eq('user_id', userId)
    .order('day', { ascending: false })
    .limit(14),
  supabase
    .from('training_plans')
    .select('id, name, goal, start_date, end_date, status, metadata')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(3),
  supabase
    .from('workouts')
    .select('id, started_at, source, workout_type, distance_meters, duration_seconds')
    .eq('user_id', userId)
    .is('superseded_by', null)
    .order('started_at', { ascending: false })
    .limit(7),
  supabase
    .from('health_events')
    .select('id, event_type, title, started_at, severity, metadata')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(5),
]);

console.log('\nBIOMARKER_RESULTS count:', biomarkerCount.count);
console.log('\nLAB_PANELS (last 5)');
console.log(panels.data);
console.log('\nRECOVERY_DAILY (last 7)');
console.log(recovery.data);
console.log('\nTODAY daily_summaries:', today);
const todayRow = todayRows.data?.[0];
if (!todayRow) {
  console.log('(none)');
} else {
  const s = todayRow.summary ?? {};
  console.log({
    day: todayRow.day,
    training_recommendation: todayRow.training_recommendation?.slice(0, 200),
    longevity_priority: todayRow.longevity_priority?.slice(0, 200),
    summary_keys: Object.keys(s),
    longevityContext: s.longevityContext,
    todaysCall_headline: s.todaysCall?.headline,
    todaysCall_rationale: s.todaysCall?.rationale,
    coachConversation_len: s.coachConversation?.length,
    longevityConversation_len: s.longevityConversation?.length,
    longevityPriorities_count: s.longevityPriorities?.length,
    longevityNarrative_snippet: typeof s.longevityNarrative === 'string' ? s.longevityNarrative.slice(0, 200) : null,
  });
}

console.log('\nDAILY_SUMMARIES last 14 days (cross-coach view)');
for (const r of recentRows.data ?? []) {
  const s = r.summary ?? {};
  const ctx = s.longevityContext;
  console.log({
    day: r.day,
    recoveryPriority: ctx?.recoveryPriority ?? null,
    evaluatedAt: ctx?.evaluatedAt ?? null,
    longevityNotes: ctx?.notes ? ctx.notes.slice(0, 120) : null,
    todaysCallHeadline: s.todaysCall?.headline ?? null,
    training_rec_snippet: r.training_recommendation?.slice(0, 100) ?? null,
    longevity_priority_snippet: r.longevity_priority?.slice(0, 100) ?? null,
  });
}

console.log('\nTRAINING_PLANS');
for (const p of plans.data ?? []) {
  const md = p.metadata ?? {};
  console.log({
    id: p.id,
    name: p.name,
    goal: p.goal,
    start: p.start_date,
    end: p.end_date,
    status: p.status,
    race: md.raceContext?.race ?? null,
    coachingPosture: md.coachingPosture ?? null,
    phaseBlocks: Array.isArray(md.phaseBlocks) ? md.phaseBlocks.length : null,
  });
}

console.log('\nWORKOUTS (last 7 canonical, not superseded)');
console.log(workouts.data);

console.log('\nHEALTH_EVENTS (last 5)');
console.log(healthEvents.data);
