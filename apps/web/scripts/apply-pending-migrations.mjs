// Apply pending Supabase migrations (007, 009, 010) via direct postgres.
//
// Needs a real postgres POOLER CONNECTION STRING in DATABASE_URL (or the
// SUPABASE_DB_URL alias), or PGHOST/PGPASSWORD. Get the string from Supabase
// Dashboard -> Project Settings -> Database -> Connection string -> "Session"
// mode. Shape:
//   postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
//
// NOTE: the DATABASE_URL currently in .env.local is the REST URL
// (https://<ref>.supabase.co/rest/v1/), which is NOT a postgres connection
// string — this script rejects it with a clear message. supabase-js (the app)
// uses REST and is unaffected; only this direct-pg path needs the pg string.
//
// As of 2026-05-30 these three migrations are already applied to the live
// project (rwdzoorymkkjnxhexwkz) via the dashboard SQL editor. This script is
// kept for future migrations / fresh environments. Idempotent: each migration
// uses "if not exists" / "add value if not exists", so re-running is safe.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const migrationsDir = resolve(__dirname, '..', '..', '..', 'supabase', 'migrations');
const files = ['007_strava_integration.sql', '009_onboarding_profile.sql', '010_athlete_souls.sql'];

// Prefer the documented DATABASE_URL; SUPABASE_DB_URL is a back-compat alias.
const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

if (!process.env.PGHOST && !connectionString) {
  console.error('Missing connection config: set DATABASE_URL (postgres pooler string) or PGHOST/PGPASSWORD.');
  process.exit(1);
}

// Guard against the common mix-up of pasting the Supabase REST URL into
// DATABASE_URL. That endpoint is for supabase-js, not for direct postgres.
if (!process.env.PGHOST && !/^postgres(ql)?:\/\//.test(connectionString)) {
  console.error(
    `DATABASE_URL is not a postgres connection string (got: ${connectionString.slice(0, 40)}...).\n` +
      'It must start with postgresql:// — use the Session-mode pooler string from\n' +
      'Supabase Dashboard -> Project Settings -> Database -> Connection string.\n' +
      'The REST URL (https://<ref>.supabase.co/rest/v1/) does NOT work here.',
  );
  process.exit(1);
}

const clientConfig = process.env.PGHOST
  ? {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? 'postgres',
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE ?? 'postgres',
      ssl: { rejectUnauthorized: false },
    }
  : { connectionString, ssl: { rejectUnauthorized: false } };

const client = new pg.Client(clientConfig);
await client.connect();

try {
  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
    console.log(`\n=== Applying ${file} ===`);
    // 007 has `alter type ... add value` which must run outside a transaction.
    // Run each file as its own batch without an explicit BEGIN/COMMIT so
    // statements that disallow transactions still work.
    await client.query(sql);
    console.log(`OK ${file}`);
  }
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
