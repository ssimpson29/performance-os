# Performance OS — Production Deployment Guide

This doc is the in-repo companion to
`docs/plans/2026-05-07-production-deployment-and-ios-backend.md`. It captures
the exact recipe for getting the Next.js web app onto a stable HTTPS host so
the iPhone Shortcut (and any future native iOS client) can push Apple Health
workouts and complete Oura OAuth against a real domain.

The current operating constraint: no Mac is available, so the native iOS app
is paused. The unblocker for HealthKit ingestion is **production-deployed
HTTPS**, not a Mac — iPhone Shortcuts can hit the signed Apple Health push
endpoint as long as it lives on a stable URL.

## Target stack

- **Web + API:** Vercel (Next.js 15 App Router).
- **Database / Auth:** Supabase (unchanged).
- **OAuth provider:** Oura.
- **Mobile ingest path (current):** iPhone Shortcut → signed POST →
  `/api/imports/apple-health/push`.

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
3. Paste it into the iPhone Shortcut that posts HealthKit workouts (and, in
   the future, into `apps/ios/PerformanceOS/App/AppConfig.swift` when the
   native client resumes).

Because the signature is HMAC of the user ID with
`APPLE_HEALTH_PUSH_SECRET`, rotating that secret invalidates every existing
signed URL — plan a rotation by re-pushing fresh URLs to all clients in the
same change.

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

## Required Scott-side actions

These cannot be automated from the repo:

1. Vercel login / project import.
2. Vercel env var entry (the matrix above).
3. Domain selection / DNS for the custom domain.
4. Oura redirect URI update in the developer portal.
5. Pasting the regenerated signed Apple Health push URL into the iPhone
   Shortcut.

## Risk notes

- `.env.local` is gitignored and contains real secrets — leave it local-only.
- `APPLE_HEALTH_PUSH_SECRET` must be production-only; rotating it requires
  redistributing the signed URL to every client.
- The iPhone Shortcut and any LAN tunnels can be retired once the production
  push URL works end-to-end.
- Oura production callback must be HTTPS.

## Out of scope here

- Native iOS app deployment to TestFlight — paused without a Mac.
- The Apple Health push 401 from the historical Swift client (CLAUDE.md
  open-work #1) — once production exists, validate the signature pipeline
  through Shortcuts first; the Swift client can be re-pointed when a Mac is
  available.
