# Performance OS — Production Deployment Guide

This doc is the in-repo companion to
`docs/plans/2026-05-07-production-deployment-and-ios-backend.md`. It captures
the exact recipe for getting the Next.js web app onto a stable HTTPS host so
the iPhone Shortcut (and any future native iOS client) can push Apple Health
workouts and complete Oura OAuth against a real domain.

**Status (2026-05-21): production is live at `https://performance-os-seven.vercel.app`.**
Phase 2 (Vercel project setup + env var entry + first deploy) and the initial
Apple Health push URL generation are done. `APPLE_HEALTH_PUSH_SECRET` was
rotated on 2026-05-21 after the previous signed URL was exposed in chat /
upload context; the old URL is dead. Native iOS work is active again (Mac
access is intermittent — see `docs/ios-todo.md`). The sections below remain
the recipe for re-deploys, environment audits, and onboarding.

## Target stack

- **Web + API:** Vercel (Next.js 15 App Router).
- **Database / Auth:** Supabase (unchanged).
- **OAuth provider:** Oura.
- **Mobile ingest path:** native iOS app (SwiftUI, in `apps/ios/`) →
  signed POST → `/api/imports/apple-health/push`. iPhone Shortcut against
  the same endpoint remains the fallback when Mac time isn't available.

## Required production environment variables

Mirror these into the Vercel project. `.env.example` at the repo root and
`apps/web/.env.example` are the source of truth for the var list; this is the
production-meaning-and-source crib.

| Variable | Required | Source | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project settings | Public-safe. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase project settings | Public-safe. Preferred over the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` alias. |
| `NEXT_PUBLIC_APP_URL` | yes | Choose at deploy time | Canonical HTTPS URL (e.g. `https://app.performanceos.com`). Used to build absolute callback / push URLs. **Never set to `localhost` in production.** |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase project settings | Server-only. Do not expose to the browser. |
| `DATABASE_URL` | yes | Supabase project settings | Use the pooler URL (CLAUDE.md pitfall #5). |
| `OURA_CLIENT_ID` | yes | Oura developer portal | |
| `OURA_CLIENT_SECRET` | yes | Oura developer portal | |
| `APPLE_HEALTH_PUSH_SECRET` | yes (prod) | Generate a fresh random string per env | Used to sign the per-user Apple Health push URL. In local dev `lib/apple-health/automation.ts` falls back to `SUPABASE_SERVICE_ROLE_KEY` when this is unset — that fallback is **intentionally not the production setup**. |
| `OURA_REDIRECT_URI` | optional | Override only if you need to | The app derives the redirect URI from `NEXT_PUBLIC_APP_URL` when this is unset. |
| `APPLE_HEALTH_IMPORT_BUCKET` | optional | Supabase storage | Only needed if you stage raw export uploads. |
| `CRON_SECRET` | yes (prod) | Generate a fresh random string | Guards the Vercel Cron endpoints (`/api/cron/sync-oura`). Vercel auto-sends `Authorization: Bearer ${CRON_SECRET}` on cron runs; the routes fail closed (500) if it's unset, so the **daily Oura sync won't run until this is set**. |
| `AI_COACH_*` | optional | OpenAI-compatible provider | Deterministic fallback is intentional when unset. |
| `OPENAI_API_KEY` | optional | Reserved | Future research / insights tooling. |

Generate a strong `APPLE_HEALTH_PUSH_SECRET`, e.g.:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Vercel project setup

1. **Import the repo** at `ssimpson29/performance-os`. Pick the repo root as
   the project root and let Vercel auto-detect the monorepo workspace
   scripts.
2. **Build settings**
   - Install command: `npm install`
   - Build command: `npm run build` (root) — Next.js detection should pick up
     `apps/web` automatically through the workspace.
   - Output: Vercel manages this.
3. **Environment variables** — paste in the matrix above. Use the same set
   for Production and Preview environments (Preview can share Supabase if
   you're comfortable with that; otherwise create a Supabase staging
   project).
4. **Domain** — start on the Vercel-provided domain to validate, then
   promote to a custom domain (e.g. `app.performanceos.com`).

## Post-deploy: rebind external services

### Oura OAuth

Update the redirect URI in the Oura developer portal to:

```
https://<production-domain>/api/imports/oura/callback
```

If Oura allows multiple redirect URIs, keep the localhost entry for local
dev. Otherwise remove it.

### Apple Health push URL

The signed push URL is built from `NEXT_PUBLIC_APP_URL` and
`APPLE_HEALTH_PUSH_SECRET`. After the production deploy:

1. Open `/settings/integrations` in production while signed in.
2. Copy the regenerated signed URL.
3. Paste it into the gitignored
   `apps/ios/PerformanceOS/App/AppConfig.local.swift` on the Mac (see
   `docs/ios-todo.md` items #1–#3 for the file pattern). The tracked
   `AppConfig.swift` stays as a placeholder template and must not
   contain real secrets. iPhone Shortcut is the same paste target if
   Mac time is unavailable.

Because the signature is HMAC of the user ID with
`APPLE_HEALTH_PUSH_SECRET`, rotating that secret invalidates every existing
signed URL — plan a rotation by re-pushing fresh URLs to all clients in the
same change.

### Scheduled jobs (Vercel Cron)

`apps/web/vercel.json` registers a daily cron at `0 11 * * *` hitting
`/api/cron/sync-oura` — the Oura recovery sync, since Oura has no webhook.
The file MUST live in `apps/web/` because the Vercel project's Root Directory
is `apps/web` — a repo-root `vercel.json` is silently ignored and the cron
never registers. Vercel picks up the schedule automatically on deploy; no
dashboard step is needed beyond setting the env var.

1. Set `CRON_SECRET` in the Vercel project (e.g.
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   Until it's set, the cron route returns 500 and the sync never runs.
2. Verify under **Vercel → Project → Settings → Cron Jobs** that the job is
   listed after deploy. You can "Run" it once manually to confirm.
3. The first run backfills every active Oura integration from its
   `last_synced_at` to today, so a long-dormant connection catches up in one
   invocation. Re-check with `node apps/web/scripts/oura-status.mjs`.

> **Plan note:** Vercel Hobby supports daily cron cadence. To sync more
> frequently (e.g. hourly), the project must be on Pro — bump the `schedule`
> in `vercel.json` then.

## Smoke checklist

After the first deploy, verify in order:

1. `/settings/integrations` loads while signed in.
2. `/api/imports/apple-health/push` exists (a `GET` should return 405; a
   signed `POST` with an empty workouts array should return 200).
3. `/api/sync/oura` exists and returns 4xx (not 500) for an unauthenticated
   request.
4. Oura OAuth round-trip completes from the production callback URL.
5. iPhone Shortcut posts a synthetic workout to the production push URL and
   a row appears in `workouts` via the Supabase SQL editor.
6. Repeat the Shortcut run; confirm no duplicate row is inserted (idempotency
   is enforced by the `(source, external_id)` pair in the workout ingestion
   pipeline).

## Scott-side actions — status

### Done (2026-05-21)

1. Vercel project imported from `ssimpson29/performance-os`.
2. Production environment variables populated in Vercel.
3. Vercel-provided domain in use: `performance-os-seven.vercel.app`.
4. Initial `APPLE_HEALTH_PUSH_SECRET` generated and set.
5. First signed Apple Health push URL generated and pasted into the
   native iOS `AppConfig.swift` on the Mac.
6. **Rotation of `APPLE_HEALTH_PUSH_SECRET`** after the prior signed
   URL was exposed in chat / upload context. New secret in Vercel,
   redeploy applied, prior URL confirmed dead (returns 401).

### Remaining

1. **Regenerate signed Apple Health push URL** from production
   `/settings/integrations` (item #1 in `docs/ios-todo.md`).
2. **Verify Oura redirect URI** in the Oura developer portal points
   at `https://performance-os-seven.vercel.app/api/imports/oura/callback`.
   If not, update it; otherwise the Oura OAuth round-trip will fail in
   production. Status currently unverified in this doc — confirm next
   time you're in the Oura developer console.
3. **Custom domain** (e.g. `app.performanceos.com`) — optional,
   defer until Vercel domain is no longer fit for purpose.
4. **Walk the smoke checklist** below once the new signed URL is in
   `AppConfig.local.swift` on the Mac and a build runs on a physical
   iPhone.

## Risk notes

- `.env.local` is gitignored and contains real secrets — leave it local-only.
- `APPLE_HEALTH_PUSH_SECRET` must be production-only; rotating it requires
  redistributing the signed URL to every client.
- The iPhone Shortcut and any LAN tunnels can be retired once the production
  push URL works end-to-end.
- Oura production callback must be HTTPS.

## Out of scope here

- Native iOS app deployment to TestFlight — depends on a sustained-Mac
  setup, not the current intermittent rented-Mac arrangement.
- iOS source-file changes batched per Mac session — see
  `docs/ios-todo.md`.
- The Apple Health push 401 (CLAUDE.md Open Work #1) — tracked there,
  with `docs/ios-todo.md` carrying the next-Mac-session queue.
