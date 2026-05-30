# apps/web/scripts

One-off operational / diagnostic scripts. All `.mjs` scripts load
`apps/web/.env.local` and talk to Supabase over the REST API using
`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Run from `apps/web/`:

```bash
node scripts/<name>.mjs [args]
```

> **Right project, always.** The live project is `rwdzoorymkkjnxhexwkz`.
> A stale wrong project (`sxpkcamjefwqcbzwayyw`) has caused mix-ups —
> when running SQL in the Supabase dashboard, confirm the URL contains
> `/project/rwdzoorymkkjnxhexwkz/`.

| Script | What it does |
|---|---|
| `check-migrations.mjs` | Probes whether migrations 007–010 are applied (column/table presence via REST). Prints `OK` / `MISS` per check. |
| `list-users.mjs` | Lists last 10 `public.users` + `auth.users` (emails masked). |
| `user-history.mjs [email]` | Full state dump for one athlete: user row, integrations, sync runs, planned sessions, plan matches, auth record. Defaults to `scottsimpsonlax29@gmail.com`. |
| `audit-cross-coach.mjs [email]` | Cross-coach state: biomarkers, recovery, today's + last-14-days `daily_summaries`, plans, workouts, health events. |
| `pending-migrations-007-009-010.sql` | The 007+009+010 bundle applied via the dashboard SQL editor on 2026-05-29/30. Idempotent. Mirrors `supabase/migrations/`. |
| `apply-pending-migrations.mjs` | Direct-`pg` migration applier. **Requires** a real `postgresql://` pooler string in `DATABASE_URL` (or `SUPABASE_DB_URL` / `PGHOST`+`PGPASSWORD`). It rejects the REST URL with a clear message — note `DATABASE_URL` in `.env.local` is currently that REST URL, so paste the Session-mode pooler string first. The dashboard-paste path (the `.sql` bundle above) is the working route today. |
