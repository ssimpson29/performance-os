# Performance OS — Claude Code Project Context

This file is auto-loaded by Claude Code. It defines project state, conventions, open work, and operating rules. Keep it current — when something changes (new convention, finished work, new pitfall), update this file.

---

## Project Purpose

Performance OS is a premium personal performance operating system that acts as:
- a **fitness coach** powered by training plans, daily workout data, and recovery context
- a **longevity guide** powered by biometrics, blood work, health history, and evidence-informed coaching

Both the coach and the longevity guide are **LLM-driven agents** grounded in structured health/training data, with a deterministic fallback layer.

North star: longevity. Short-term target race: **Swiss Alps 100 (160km), August 7, 2026**.

The app merges four layers: **Planned** (training plan) · **Actual** (Apple Watch/Health workouts) · **Recovered** (Oura sleep/readiness) · **Recommended** (coaching logic).

---

## Architecture

```
performance-os/
  apps/
    web/                # Next.js 15 App Router + Supabase (PRIMARY ACTIVE WORK)
    ios/                # Native SwiftUI + HealthKit scaffold (active in batched Mac sessions — see docs/ios-todo.md)
  docs/                 # Product, UX, architecture
    plans/              # Multi-step plan markdown (writing-plans skill output)
  research/             # Inspiration notes
  supabase/             # SQL migrations and database docs
  workers/python/       # Background sync/import workers
  packages/config/      # Shared monorepo config placeholder
  skills/               # Project-local skills
```

**Stack:**
- Next.js 15 (App Router) / React 19 / TypeScript 5.8 strict
- Supabase (auth + Postgres) — `@supabase/supabase-js` + `pg` for direct queries
- TailwindCSS 3
- Vitest 4 for tests
- Node 22+
- Workspace: `@performance-os/web`

**Env file:** `apps/web/.env.local` (gitignored). Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`

Optional LLM coach env (deterministic fallback if missing — intentional):
- `AI_COACH_API_KEY`
- `AI_COACH_MODEL`
- `AI_COACH_BASE_URL` (OpenAI-compatible)

Strava integration env (required for the Strava OAuth + sync flow;
webhook token is additionally required for real-time push):
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_WEBHOOK_VERIFY_TOKEN` (opaque random string; reused when
  registering the push subscription via `POST /api/strava/register-webhook`)

See `.env.example` at repo root.

---

## Commands

Run from repo root:

```bash
npm install
npm run dev          # next dev
npm run build        # next build
npm run typecheck    # tsc strict
npm run lint
npm run test --workspace @performance-os/web   # vitest run
```

---

## Operating Constraints

**Mac access is intermittent.** Scott borrows a friend's Mac for Xcode sessions (currently active). Day-to-day work is WSL/Windows. This means:
- `apps/ios/` work is active, but batched into Mac sittings. See `docs/ios-todo.md` for the running queue of Xcode/Mac actions — never do iOS work ad-hoc.
- HealthKit ingestion: native iOS app via the signed Apple Health push endpoint is the active path. iPhone Shortcuts on the same endpoint remains the fallback (CLAUDE.md Open Work #1 workaround).
- No TestFlight or App Store work yet.
- Production is on Vercel at `https://performance-os-seven.vercel.app` — the iPhone app posts there directly.

**Billing:** This project runs under Claude Max OAuth subscription, not metered API. Before launching `claude`, ensure `ANTHROPIC_API_KEY` is unset in the shell.

**Repo location:** `C:\Users\scott\OneDrive\Documents\Claude\Projects\performance-os` (canonical). Do not work from any other path. The previous WSL copy is gone — GitHub `ssimpson29/performance-os` is the source of truth.

---

## Conventions (non-negotiable)

### Athlete identity scoping
- Browser/UI flows derive athlete from Supabase auth cookies via
  `getAuthenticatedUserId()` or `getAuthenticatedUser()` (in
  `apps/web/lib/server-auth.ts`).
- **Session lifecycle:**
  - `apps/web/middleware.ts` runs on every request, builds a Supabase
    SSR client with full `getAll`/`setAll` cookie wiring, and calls
    `supabase.auth.getUser()` to refresh expired access tokens. Without
    this, `getAuthenticatedUser()` would start returning null after the
    access token expired (~1 hour) even with a valid refresh token.
  - `apps/web/app/auth/callback/route.ts` is the magic-link landing
    handler: it reads `?code=` and `?next=`, calls
    `supabase.auth.exchangeCodeForSession()` to write the session
    cookies, then redirects to the sanitized `?next=` (default
    `/coach`). On error it redirects to `/settings/integrations?auth_error=...`.
  - `POST /api/auth/magic-link` sets `emailRedirectTo` to
    `/auth/callback?next=...` and sanitizes `next` to a known prefix
    list (`/coach`, `/longevity`, `/plan`, `/today`, `/settings`) to
    prevent open-redirect.
- **Never** trust `userId` from query, body, or form data on
  browser-driven routes.
- Routes converted to auth-scoped:
  - `POST /api/imports/training-plan`
  - `POST /api/imports/workouts`
  - `POST /api/imports/apple-health`
  - `GET  /api/imports/oura/connect`
  - `POST /api/sync/oura`
  - `GET  /api/imports/strava/connect`
  - `POST /api/sync/strava`
  - `GET  /api/strava/register-webhook`
  - `POST /api/strava/register-webhook`
  - `POST /api/coach/message`
  - `POST /api/longevity/evaluate`
  - `POST /api/imports/biomarker-panel`
  - `POST /api/imports/biomarker-panel-image`
- **Intentional exceptions:**
  - `POST /api/imports/apple-health/push` uses signed URL + HMAC
    signature for iPhone Shortcut automation. Do NOT convert to cookie
    auth. The signed URL itself is the credential.
  - `GET /api/imports/oura/callback` and `GET /api/imports/strava/callback`
    both run as the OAuth-redirect-target, which arrives at our domain
    with no Supabase session cookie (the browser was just on
    cloud.ouraring.com / www.strava.com). They carry the athlete
    binding in the OAuth `state` param (`oura-import:<userId>` /
    `strava-import:<userId>`), built by the connect route from
    `getAuthenticatedUserId()`. If `state` is missing the userId, the
    callback short-circuits to a "code received but unbound" response
    rather than persisting a row.
  - `GET  /api/webhooks/strava` and `POST /api/webhooks/strava` are
    Strava's push-subscription endpoints. The GET handshake verifies
    `hub.verify_token` against `STRAVA_WEBHOOK_VERIFY_TOKEN`. The POST
    carries an `owner_id` (Strava athlete id) that maps to a row in
    `user_integrations` via `external_user_id`; unknown owners are
    acknowledged with a 200 and dropped (fails closed). Strava cannot
    carry a Supabase session, so this is a documented exception to
    cookie auth.
- Two athletes signed into the same deployment must never read or
  write each other's data through browser flows.

### Coach architecture (3 layers — keep separate)

**Training Coach** (daily, race-driven):
1. **Deterministic engine** — `apps/web/lib/training-plan/adaptive-coach.ts` (pure, heavily tested)
2. **Athlete-scoped data loader** — `apps/web/app/plan/coach-data.ts`
3. **Interactive coach service** — `apps/web/lib/agents/training-coach.ts` + `apps/web/app/coach/coach-data.ts` (server) + `apps/web/app/coach/coach-chat.tsx` (client)

**Longevity Guru** (strategic, healthspan-driven):
1. **Deterministic engine** — `apps/web/lib/longevity/{reference-ranges,trend-detection,prioritization}.ts`
2. **Athlete-scoped data loader** — `apps/web/app/longevity/longevity-data.ts`
3. **Interactive guru service** — `apps/web/lib/agents/longevity-guru.ts` + `apps/web/lib/longevity/persistence.ts` (cross-write)

LLM is optional. Always preserve deterministic fallback for tests, local dev, and provider outages.

### Image-based ingestion (vision LLM)
- `POST /api/imports/biomarker-panel-image` accepts a JPG/PNG/WebP/PDF
  and calls a vision-capable model (`AI_COACH_MODEL` must be vision-capable —
  `gpt-4o`-class). Returns extracted markers in a **review** payload —
  does not save to `biomarker_results` directly. UI at `/longevity/import`
  surfaces the review table; the user corrects, then Save commits via the
  existing `POST /api/imports/biomarker-panel` JSON route. Unmatched
  marker names and unit mismatches are flagged but skipped on save.
- For training plans: the existing `POST /api/imports/training-plan`
  takes the Excel workbook directly (no vision needed — the parser is
  deterministic). UI at `/plan/import`.
- Both upload UIs require sign-in.

**Two coaches, one engine.** Performance OS runs two LLM-driven agents
over this 3-layer engine: the **Training Coach** (adaptive, daily, races
to Swiss Alps 100) and the **Longevity Guru** (strategic, weekly/monthly,
optimizes healthspan past the race). They share the data layer, share
auth, cross-influence **bidirectionally** via
`daily_summaries.summary.longevityContext`, and resolve conflicts with
sustained-signal-wins-for-longevity / acute-need-wins-for-training.

Cross-influence is live in both directions:
- **Longevity Guru → Training Coach.** `lib/agents/longevity-guru.ts`
  writes `recoveryPriority: 'low' | 'normal' | 'elevated'` to
  `daily_summaries.summary.longevityContext`. The Training Coach loader
  (`app/plan/coach-data.ts::loadLongevityContextForAthlete`) reads it
  back, and `lib/training-plan/adaptive-coach.ts` treats `'elevated'`
  as a downgrade input: suppresses adapt-up regardless of performance
  delta, biases `planAdaptation.suggestion` toward `'lower'`, and defers
  Tuesday quality.
- **Training Coach → Longevity Guru.** Sustained training-load overreach
  feeds `runLongevityGuru({ trainingLoadOverreach: { sustainedOverreach,
  description } })` and adds a `performance_recovery` lever.

See `docs/two-coach-architecture.md` for the higher-level model and
worked examples (adapt-up on healthy over-performance, conversational
injury management with re-evaluation, phase-aware behavior).

### Coach memory persistence
Use `daily_summaries.summary` JSON blob:
- `coachConversation` — recent athlete/coach messages
- `coachRationale` — flattened evidence string
- `coachRecommendations`
- `coachCautions`
- `coachFollowUp` — `{ easyThroughDate, checkInDate, status }`
- `longevityContext` — `{ recoveryPriority: 'low' | 'normal' | 'elevated', notes, evaluatedAt }` — written by Longevity Guru; the Training Coach reads `recoveryPriority === 'elevated'` as a downgrade input.
- `longevityPriorities`, `longevityWatching`, `longevityNarrative`, `longevityCautions` — Longevity Guru run state (most recent evaluation).

Use `training_recommendation` for the top-line current Training Coach answer; `longevity_priority` for the top-line current Longevity Guru lever.

### Injury/strain reporting
When athlete message mentions strain/injury, also insert `health_events` row:
- `event_type='injury'`
- `metadata.source='coach_message'`

### Follow-up window logic
- Strain detected → `easyThroughDate = today + 3 days`, `checkInDate = today + 4 days`
- On `checkInDate`, surface pending follow-up in UI.
- **Critical ordering pitfall:** Check positive-recovery phrases (`pain free`, `better`, `normal`) BEFORE generic negative matching. Otherwise "pain free" matches "pain" and misclassifies.

### Training plan persistence
Persist race context on `training_plans`:
- `end_date` = race date
- `goal` = normalized goal summary
- `metadata.weeklyStructure`
- `metadata.phaseBlocks`
- `metadata.supportTemplates`
- `metadata.raceContext`

### Plan-vs-actual workflow
The training plan defines weekly structure baseline. The coach adapts daily workouts using recent completed load + recovery context. Both Training Coach and Longevity Guru are LLM-driven agents, not static rules.

### Duplicate-workout handling (multi-source ingest)
The same training session can land in Performance OS twice: Apple Watch
auto-uploads to Strava, and the athlete sometimes manually adds notes on
Strava. We keep **one row per source** so no source-specific data is
lost, and resolve the duplicate via a `superseded_by` self-reference on
the `workouts` table.

- **Matcher.** Pure helpers in `apps/web/lib/workouts/duplicate-matching.ts`:
  `workoutFamily` collapses Strava/Apple/manual type vocabularies to
  `run | bike | walk | hike | strength | other`; `isSameSession`
  requires matching family, `started_at` within ±120s, and (when both
  have one) `durationSeconds` within ±10%; `findExistingMatch` returns
  the first hit.
- **Source precedence.** Apple Watch wins for metrics (HR, distance,
  duration, segments, cadence) — its `workouts` row is canonical.
  Strava wins for the written description, which gets forwarded onto
  the canonical Apple row's `description` column.
- **Link direction.** The Strava row's `superseded_by` points at the
  canonical Apple row. Downstream readers (e.g.
  `loadCompletedWorkouts` in `apps/web/app/plan/coach-data.ts`) should
  filter `.is('superseded_by', null)` so the coach doesn't
  double-count an overlapping session.
- **Ordering robustness.** Either source can arrive first.
  `lib/strava/activity-sync.ts` runs the matcher on Strava-pulled
  activities against existing workouts and sets `superseded_by` when an
  Apple row already exists. The Apple-side merge (Phase 3 of
  `docs/plans/2026-05-22-strava-integration.md`) handles the opposite
  ordering by running the same matcher inside
  `POST /api/imports/apple-health/push` after upsert.

---

## Open Work (priority order)

### 1. iOS 401 on Apple Health push — pending Mac smoke test
- Status (2026-05-21): `APPLE_HEALTH_PUSH_SECRET` was rotated in Vercel after the previous signed URL was exposed in chat / upload context. The old URL is confirmed dead (returns 401).
- **Next:** regenerate the signed URL from production `/settings/integrations`, paste it into a gitignored `AppConfig.local.swift` on the Mac, and run a smoke test from Xcode. Full queue in `docs/ios-todo.md` (Next session items 1–8).
- **Workaround if Mac time is delayed:** iPhone Shortcuts hitting the same signed endpoint validates the signature pipeline end-to-end without Xcode. Steps in `docs/ios-todo.md` (Later → iOS 401 investigation — fallback path).

### 2. Persist race context on `training_plans` — done (2026-05-21)
- Shipped in commit `2eb0588` (`feat(training-plan): persist race context on training_plans`).
- `training_plans` now persists `end_date`, `goal`, `metadata.weeklyStructure`, `metadata.phaseBlocks`, `metadata.supportTemplates`, and (when supplied) `metadata.raceContext`.
- Race-aware adaptive coach (Open Work #3) is built on this foundation.

### 3. Race-aware adaptive coach — done (2026-05-21)
- **Deterministic core** in `apps/web/lib/training-plan/adaptive-coach.ts`:
  `computePhasePosition`, `computeRecoveryTrend`, `computePerformanceDelta`,
  and a layered `adaptWeeklyStructure` that handles race-phase awareness,
  adapt-up on healthy over-performance, adapt-down on lagging
  adherence / degraded recovery, race-week lock, and taper guards.
- **LLM Training Coach service** in `apps/web/lib/agents/training-coach.ts`:
  wraps the deterministic engine with athlete-facing narrative, deterministic
  fallback when `AI_COACH_*` env is missing, conversational injury detection
  (positive-recovery phrase check before negative, per pitfall #1),
  `coachFollowUp` window open/close, and 20-message conversation memory.
- **API surface:** `POST /api/coach/message` (auth-scoped) — accepts
  an athlete message, runs the deterministic engine via the data loader,
  composes the coach reply via the LLM service, and persists the run
  to `daily_summaries.summary` (merging without clobbering longevityContext
  or other future cross-write keys). Injury detections insert a
  `health_events` row with `metadata.source = 'coach_message'`.

### 4. Strava integration — Phase 2 done (2026-05-22)
- Schema: migrations `007_strava_integration.sql` (workout_source enum +
  `description` + `superseded_by` columns + workouts(user_id, started_at)
  index) and `008_strava_provider.sql` (integration_provider enum).
- Routes (auth-scoped):
  - `GET  /api/imports/strava/connect` — builds the OAuth URL with
    `state=strava-import:<userId>` from `getAuthenticatedUserId()`.
  - `GET  /api/imports/strava/callback` — exchanges the code, upserts
    `user_integrations` (provider='strava') from the state-derived
    userId, redirects to `/settings/integrations?strava=connected`.
  - `POST /api/sync/strava` — pulls recent activities and runs the
    duplicate matcher; returns a summary.
- Sync orchestration in `apps/web/lib/strava/activity-sync.ts`:
  loads integration row, refreshes the Strava token within 60s of
  expiry, fetches `/athlete/activities?after=<unix>`, normalizes each
  activity into a candidate, runs `findExistingMatch` against the
  athlete's workouts in the same window, inserts Strava rows with
  `superseded_by` set when an Apple-sourced match exists, and forwards
  the description onto the canonical Apple row when the Apple row had
  no description. Idempotent on repeated runs via
  `(source, external_id)` lookup.
- Settings UI: `components/integrations/strava-card.ts` (server) +
  `sync-strava-button.tsx` (client) on `/settings/integrations`.
- **Phase 3 done (2026-05-22):** `apps/web/lib/workouts/apple-strava-merge.ts`
  runs after the Apple Health / Apple Watch upsert inside
  `importActualWorkouts` — for each newly-persisted Apple row it finds a
  still-canonical Strava workout in the same time window, sets that
  Strava row's `superseded_by` to the Apple row, and forwards the
  Strava description onto the Apple row when the Apple row has none.
  Failure is logged and non-fatal so a transient merge issue can't
  block the Apple sync. The coach data loader
  (`apps/web/app/plan/coach-data.ts::loadCompletedWorkouts`) now filters
  `.is('superseded_by', null)` so a duplicated session counts once.
- **Phase 4 done (2026-05-22):** real-time push via Strava webhooks.
  Per-activity logic extracted from the batch loop into
  `processStravaActivity` so the webhook and the batch sync share one
  implementation. New helpers in `lib/strava/activity-sync.ts`:
  `loadStravaIntegrationByOwnerId`, `ensureFreshStravaToken`,
  `handleStravaActivityEvent`. New endpoints:
  - `GET  /api/webhooks/strava` — Strava subscription challenge.
  - `POST /api/webhooks/strava` — receives `aspect_type='create'|'update'|'delete'`
    events. Ignores non-activity events, ignores deletes (for now),
    looks up the integration by `owner_id` and dispatches to
    `handleStravaActivityEvent`.
  - `GET  /api/strava/register-webhook` — auth-scoped; lists the
    current subscription via the Strava API.
  - `POST /api/strava/register-webhook` — auth-scoped; deletes any
    existing subscription, creates a fresh one at
    `${NEXT_PUBLIC_APP_URL}/api/webhooks/strava` with the env-stored
    verify token. Idempotent.
  Settings UI adds a "Register webhook" button next to "Sync now" on
  the Strava card so the one-time registration is a click. Required
  env: `STRAVA_WEBHOOK_VERIFY_TOKEN` (any opaque string).

### 5. Plan docs index (existing)
- `docs/plans/2026-05-04-training-import-and-adaptive-coach.md`
- `docs/plans/2026-05-05-iphone-first-app-mvp.md`
- `docs/plans/2026-05-07-production-deployment-and-ios-backend.md`
- `docs/plans/2026-05-21-auth-scoping.md`
- `docs/plans/2026-05-21-longevity-guru.md`
- `docs/plans/2026-05-22-strava-integration.md`
- `docs/deploy.md` — in-repo deployment guide (env matrix, Vercel
  recipe, post-deploy steps).


---

## Pitfalls (don't re-learn these)

1. **"pain free" contains "pain"** — coach fallback misclassifies positive recovery as injury unless positive checks run first.
2. **Vitest + TSX import analysis** — Vitest 4 chokes on some Next.js TSX page/component imports. Workaround: extract testable slices into `.ts` modules using `React.createElement`.
3. **Next.js env import-time pitfall** — accessing `process.env.X` at module top level causes brittle tests/runtime behavior. Read env inside functions or via a centralized `lib/env.ts` accessor.
4. **Stale `.next` build chunk errors** — if dev server throws weird chunk errors, `rm -rf apps/web/.next` and restart.
5. **Supabase WSL DATABASE_URL** — use the pooler URL for `pg` direct queries; the direct DB URL sometimes fails from WSL due to IPv6. (Less relevant from Windows-native Claude Code, but document for shared workflows.)
6. **Don't query "latest" training plan or user row globally** — always scope to athlete.

---

## Testing Approach

When converting any route from caller-supplied `userId` to auth-scoped, add tests for:
1. 401 when not signed in
2. uses authenticated athlete ID when signed in
3. ignores caller-supplied `userId` if present
4. happy path still succeeds

Coach logic tests live in `apps/web/tests/`. Key files: `adaptive-coach.test.ts`, `training-coach.test.ts`, `coach-route.test.ts`, `server-auth.test.ts`, `training-plan-persistence.test.ts`.

---

## Definition of Done (per change)

```bash
npm run test --workspace @performance-os/web   # all green
npm run typecheck                              # clean
npm run build                                  # clean
```

Then commit with a conventional message. Reference open-work item by number when relevant. Push to `origin/main` (GitHub `ssimpson29/performance-os`).

---

## When You (Claude Code) Start

1. Read this file fully.
2. Run `git log --oneline -10` and `git status`.
3. Skim `docs/plans/` for active plan docs.
4. Skim `apps/web/lib/training-plan/` for coach state.
5. Propose the next 3 concrete actions before writing any code.
