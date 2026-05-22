# Strava Integration Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Ingest Strava activities into Performance OS alongside Apple Health
workouts, with duplicate detection so a single training session that exists
in both sources is represented as one canonical workout.

**Architecture:** Keep one row per source (Apple Health, Apple Watch, Strava)
so no source-specific data is lost. A `superseded_by` self-reference marks
non-canonical duplicates; downstream queries filter to canonical rows
(where `superseded_by is null`). When a duplicate is detected, the canonical
row is the one with the richer metric set — Apple Watch data wins because
it captures HR, segments, cadence, etc. The Strava row's description gets
forwarded onto the canonical Apple row's `description` column so the
athlete's written notes stay visible alongside the watch metrics.

**Source precedence (when both exist for the same session):**
- Metrics (HR, distance, duration, energy, cadence, segments) → Apple.
- Description / notes → Strava.
- Both rows kept; Strava row marks `superseded_by = <apple row id>`.

**Matching algorithm** (pure function, no DB; lives in
`apps/web/lib/workouts/duplicate-matching.ts`):
- Same athlete.
- `started_at` within ±2 minutes.
- Duration within ±10%.
- Workout-type *family* matches (Run ↔ Outdoor Run ↔ Trail Run ↔ Virtual Run
  all map to family `'run'`; Ride / Cycling / MountainBikeRide → `'bike'`;
  Walk → `'walk'`; Hike → `'hike'`; WeightTraining / Strength Training →
  `'strength'`; anything else → `'other'`).

**Ordering robustness:** Either source can arrive first. The Apple Health
push and the new Strava sync both run the matcher against the athlete's
existing workouts on insert; whichever row was first becomes the candidate
and the second insert links to it via `superseded_by` (if Strava arrives
second) OR adopts the Strava description onto the canonical Apple row
(if Apple arrives second after Strava).

---

## Phase 1 — Foundation

### Task 1.1: Schema migration
**Files:**
- Create: `supabase/migrations/007_strava_integration.sql`

**Steps:**
- `alter type public.workout_source add value if not exists 'strava';`
- `alter table public.workouts add column if not exists description text;`
- `alter table public.workouts add column if not exists superseded_by uuid references public.workouts(id) on delete set null;`
- `create index if not exists workouts_user_start_idx on public.workouts(user_id, started_at);`

**Scott action:** open Supabase SQL editor → paste the migration → run. Verify with
`select source from pg_enum where enumtypid = 'public.workout_source'::regtype;`
that `strava` is present.

### Task 1.2: Duplicate-matching helper
**Files:**
- Create: `apps/web/lib/workouts/duplicate-matching.ts`
- Create: `apps/web/tests/duplicate-matching.test.ts`

**Steps:**
- `workoutFamily(type: string): 'run' | 'bike' | 'walk' | 'hike' | 'strength' | 'other'`
- `isSameSession(a, b, opts?: { toleranceSeconds, durationPctTolerance })`
- `findExistingMatch(candidate, existing: WorkoutLike[])` returns the first match or null
- Tests: family mapping (Run/Trail Run/VirtualRun/Outdoor Run → 'run'),
  time edges (±60s match, ±150s no), duration tolerance, mismatched
  families, missing duration handled.

---

## Phase 2 — Strava OAuth + sync

### Task 2.1: OAuth env + Supabase integration row
**Env vars (added to `.env.example` + Vercel):**
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`

`user_integrations` already supports `provider` enum values for token
storage. Add `'strava'` if not present (check `001_extensions_and_enums.sql`).

### Task 2.2: `GET /api/imports/strava/connect`
- Auth-scoped via `getAuthenticatedUserId()`.
- Builds the OAuth URL with `state=strava-import:<userId>` and scope
  `read,activity:read_all`.
- Redirects to Strava's authorize endpoint.

### Task 2.3: `GET /api/imports/strava/callback`
- Reads `?code=` and `?state=`.
- Parses `userId` from state (same pattern as Oura callback — exception
  documented in CLAUDE.md since redirect carries no auth cookie).
- POSTs to Strava token endpoint to exchange code → access_token + refresh_token.
- Persists encrypted tokens to `user_integrations` row.

### Task 2.4: `POST /api/sync/strava` route
- Auth-scoped.
- Loads stored tokens; refreshes if expired.
- Pulls `/athlete/activities` for the recent window (default last 30 days).
- For each activity:
  - Normalize to a `WorkoutLike` shape.
  - Run `findExistingMatch` against the athlete's existing workouts in the
    same start-time window (DB query: `where user_id = ? and started_at
    between started_at - 2 min and started_at + 2 min`).
  - If a match exists *and* the match is Apple-sourced:
    - Insert the Strava row with `superseded_by = <apple row id>`.
    - Update the Apple row's `description` if the Strava activity has one.
  - If a match exists *and* the match is Strava-sourced (idempotency):
    - Upsert via existing `(source, external_id)` unique constraint, no link change.
  - If no match exists:
    - Insert as a new row with `source='strava'`.
- Idempotent on repeated runs.

### Task 2.5: Strava setup UI on `/settings/integrations`
- New card paralleling the Oura connection card.
- Shows connect button when no token; shows last-synced + Sync Now buttons
  when connected.

---

## Phase 3 — Apple-side merge + canonical-only reads

### Task 3.1: Apple-health push → run the matcher on insert
- After upserting an Apple Watch / Apple Health workout, look for a
  prior `source='strava'` row matching the same session.
- If found: copy the Strava row's description onto the Apple row,
  update the Strava row's `superseded_by = <apple row id>`.

### Task 3.2: Downstream readers filter on `superseded_by is null`
- `loadCompletedWorkouts` in `apps/web/app/plan/coach-data.ts` adds
  `.is('superseded_by', null)` so the coach doesn't see double-counted
  workouts when both Apple and Strava sync the same session.
- Same filter for any future plan-vs-actual reads.

### Task 3.3: CLAUDE.md updates
- Add the two new auth-scoped routes (`/api/imports/strava/connect`,
  `/api/sync/strava`) and the callback exception list (Oura callback
  + Strava callback both use state-based userId — document together).
- New convention block: "Duplicate-workout handling" — explains the
  `superseded_by` pattern and the source precedence rule.

---

## Out of scope (deliberate)

- Backfilling existing Apple-only workouts with Strava descriptions
  retroactively. Once Strava is connected, going-forward sync handles it.
  A one-shot backfill helper can be added later if the gap matters.
- Photo / media attachments from Strava — text description only for now.
- Segment-level data from Strava — Apple-sourced lap/segment metrics
  are the primary signal; Strava segments can be added later if
  course-specific intel becomes valuable (e.g., comparing repeats of
  the same trail).
- Strava webhooks for real-time push. Polling sync is simpler for
  Phase 2; webhooks can be added when latency matters.
