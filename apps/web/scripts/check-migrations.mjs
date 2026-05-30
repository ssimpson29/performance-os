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
console.log();

const probes = [
  { label: 'migration 009 (users.primary_goal)', table: 'users', column: 'primary_goal' },
  { label: 'migration 009 (users.onboarding_completed_at)', table: 'users', column: 'onboarding_completed_at' },
  { label: 'migration 009 (users.weekly_training_hours_baseline)', table: 'users', column: 'weekly_training_hours_baseline' },
  { label: 'migration 010 (athlete_souls)', table: 'athlete_souls', column: 'user_id' },
  { label: 'migration 010 (athlete_soul_revisions)', table: 'athlete_soul_revisions', column: 'id' },
  { label: 'migration 007 (workouts.superseded_by)', table: 'workouts', column: 'superseded_by' },
  { label: 'migration 007 (workouts.description)', table: 'workouts', column: 'description' },
  { label: 'migration 008 (user_integrations.provider strava)', table: 'user_integrations', column: 'provider' },
];

for (const p of probes) {
  const { error } = await supabase.from(p.table).select(p.column).limit(0);
  if (!error) {
    console.log(`OK   ${p.label}`);
  } else {
    console.log(`MISS ${p.label}  ->  ${error.message}`);
  }
}
