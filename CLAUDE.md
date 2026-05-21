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
- **Never** trust `userId` from query, body, or form data on
  browser-driven routes.
- Routes converted to auth-scoped:
  - `POST /api/imports/training-plan`
  - `POST /api/imports/workouts`
  - `POST /api/imports/apple-health`
  - `GET  /api/imports/oura/connect`
  - `POST /api/sync/oura`
  - `POST /api/coach/message`
  - `POST /api/longevity/evaluate`
  - `POST /api/imports/biomarker-panel`
  - `POST /api/imports/biomarker-panel-image`
- **Intentional exception:** `POST /api/imports/apple-health/push`
  uses signed URL + HMAC signature for iPhone Shortcut automation. Do
  NOT convert to cookie auth. The signed URL itself is the credential.
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

### 4. Plan docs index (existing)
- `docs/plans/2026-05-04-training-import-and-adaptive-coach.md`
- `docs/plans/2026-05-05-iphone-first-app-mvp.md`
- `docs/plans/2026-05-07-production-deployment-and-ios-backend.md`
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
