# Production Deployment + iPhone Backend Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Deploy Performance OS to a stable HTTPS production environment so the native iPhone app can sync workouts and Oura data without relying on local tunnels or LAN IPs.

**Architecture:** Host the current Next.js app and API routes on Vercel, keep Supabase as the database/auth/system-of-record layer, and point the iPhone app at the production API base URL. Use a custom domain once the first production deploy works. Update Oura OAuth settings to the production callback immediately after deploy.

**Tech Stack:** Next.js App Router, Vercel, Supabase, Oura OAuth, SwiftUI iPhone client.

---

## Recommended long-term path

### Why Vercel
- Best fit for the existing Next.js app/router/API route structure.
- Automatic HTTPS, preview deployments, env var management, logs, and quick rollback.
- Minimal ops overhead compared with Docker/VPS for this stage.
- Cleanest production target for the future iPhone app because Apple/HealthKit client traffic should hit a stable HTTPS domain.

### What stays the same
- Supabase remains the database and auth backbone.
- Existing API routes stay in `apps/web/app/api/...`.
- Oura callback route remains in the web app.
- The iPhone app still posts workouts to `/api/imports/apple-health/push`.

### What changes
- `NEXT_PUBLIC_APP_URL` becomes the production URL.
- Oura redirect URI changes from localhost to the production callback URL.
- The iPhone app `AppConfig.swift` points to the production API host instead of a LAN IP.

---

## Phase 1 — Prepare production config

### Task 1: Add deployment docs and target environment list
**Objective:** Make the deployment explicit and reproducible.

**Files:**
- Create: `docs/plans/2026-05-07-production-deployment-and-ios-backend.md`
- Create later: `apps/web/.env.example`

**Checklist:**
- Document required env vars.
- Separate local-only values from production values.
- Record the intended production domain.

### Task 2: Create `.env.example`
**Objective:** Provide a safe template for local + production configuration.

**Files:**
- Create: `apps/web/.env.example`

**Include placeholders for:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL`
- `OURA_CLIENT_ID`
- `OURA_CLIENT_SECRET`
- `APPLE_HEALTH_PUSH_SECRET` (recommended explicit secret instead of overloading service-role key)

### Task 3: Stop using placeholder iPhone config
**Objective:** Make the iPhone app ready for a deployed backend.

**Files:**
- Modify later: `apps/ios/PerformanceOS/App/AppConfig.swift`

**Step:**
- Replace the LAN/local URL with the production HTTPS domain after the first deploy succeeds.

---

## Phase 2 — First Vercel deployment

### Task 4: Create Vercel project
**Objective:** Get the web app deployed with stable HTTPS.

**Requires Scott account access:** yes.

**Actions in Vercel:**
- Import the repo.
- Set root directory to repo root if using monorepo auto-detect, or keep default and let workspace scripts drive build.
- Confirm build command uses existing monorepo scripts.

**Expected build path:**
- Install: `npm install`
- Build: `npm run build`

### Task 5: Add production environment variables
**Objective:** Recreate local app settings safely in Vercel.

**Requires Scott account access:** yes.

**Production env vars:**
- Supabase public URL
- Supabase publishable key
- Supabase service role key
- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL=https://<production-domain>`
- Oura client ID
- Oura client secret
- `APPLE_HEALTH_PUSH_SECRET=<new-random-secret>`

**Important:**
- Do not reuse `localhost` anywhere in production env.
- Prefer a dedicated `APPLE_HEALTH_PUSH_SECRET` rather than using the Supabase service role key as the URL-signing secret long-term.

### Task 6: Deploy and verify
**Objective:** Confirm the production web/API app is alive.

**Verify:**
- `/settings/integrations` loads
- `/api/imports/apple-health/push` route exists
- `/api/sync/oura` route exists
- API routes return expected 4xx/2xx behavior instead of 500/build failures

---

## Phase 3 — Post-deploy integrations

### Task 7: Update Oura app settings
**Objective:** Make Oura OAuth work against production.

**Requires Scott account access:** yes.

**Update in Oura developer portal:**
- Redirect URI to:
  - `https://<production-domain>/api/imports/oura/callback`

**Keep local callback only if Oura allows multiple redirect URIs.**

### Task 8: Regenerate Apple Health push URL
**Objective:** Move the iPhone app to the production backend.

**Files:**
- Verify logic in `apps/web/lib/apple-health/automation.ts`
- Modify: `apps/ios/PerformanceOS/App/AppConfig.swift`

**Steps:**
- Build the signed push URL from the production domain.
- Paste that production URL into the iPhone app config.
- Remove any LAN IP / localhost values from the iPhone app.

---

## Phase 4 — Production smoke tests

### Task 9: Verify smoke-test sync from iPhone simulator/app
**Objective:** Prove end-to-end connectivity from the native app to production.

**Steps:**
- Use the existing smoke-test `Sync now` button.
- Confirm the POST succeeds against production.
- Confirm a workout row appears in Supabase.

### Task 10: Replace smoke-test payload with real HealthKit reader
**Objective:** Convert the iPhone app from synthetic to real data.

**Files:**
- `apps/ios/PerformanceOS/Services/HealthKitWorkoutReader.swift`
- `apps/ios/PerformanceOS/Services/WorkoutSyncService.swift`

**Verify:**
- manual sync reads real workouts
- repeated syncs do not duplicate rows
- `/plan` reflects actual imported workouts

---

## Required account actions Scott must do

1. Vercel login / project import
2. set production environment variables
3. choose or connect a domain
4. update Oura redirect URI in Oura developer settings
5. run the iPhone app against the production URL

---

## Recommended domain strategy

Start with:
- Vercel-provided domain for first validation

Then move to:
- custom production domain, e.g. `app.performanceos.com`

Reason:
- fast validation first
- stable branded domain second

---

## Risk notes

- Production app secrets must not be committed to git.
- The current local `.env.local` contains real secrets and should remain local-only.
- The iPhone app cannot rely on LAN IPs or localhost in production.
- Oura production callback must be HTTPS.

---

## Definition of done

Production deployment is considered ready when:
- Vercel app is live on HTTPS
- Supabase-backed routes work in production
- Oura OAuth completes against production callback
- iPhone app `Sync now` reaches the production backend successfully
- Apple Health workout rows persist without duplicate explosions
