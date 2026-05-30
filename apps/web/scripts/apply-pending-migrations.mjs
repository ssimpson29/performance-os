// Apply pending Supabase migrations (007, 009, 010) via direct postgres.
// Requires SUPABASE_DB_URL on the command line or in .env.local — the
// postgres pooler connection string from Supabase Dashboard ->
// Project Settings -> Database -> Connection string -> "Session" mode.
// Looks like: postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
//
// Idempotent: each migration uses "if not exists" / "add value if not exists",
// so re-running is safe.

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

const clientConfig = process.env.PGHOST
  ? {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? 'postgres',
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE ?? 'postgres',
      ssl: { rejectUnauthorized: false },
    }
  : { connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } };

if (!clientConfig.host && !clientConfig.connectionString) {
  console.error('Missing PGHOST/PGPASSWORD or SUPABASE_DB_URL.');
  process.exit(1);
}

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
