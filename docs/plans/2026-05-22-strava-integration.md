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
- Polling cron (Vercel Cron). Replaced by Phase 4 webhooks below —
  real-time push is the better architecture for a single-athlete app
  and shares the same dedup / matcher pipeline.

---

## Phase 4 — Strava webhooks (real-time push)

**Goal:** Strava notifies Performance OS within ~30s of an activity being
saved, so the coach sees today's workout without an athlete-initiated
sync click. Polling cron is skipped — webhooks are the right shape and
not much more code.

### Architecture

- **One subscription per Strava app** (not per athlete). Once
  registered, the subscription receives `aspect_type='create'|'update'|'delete'`
  events for every athlete who has authorized this app's OAuth.
- Strava POSTs a tiny payload (`object_type`, `object_id`, `aspect_type`,
  `owner_id`, ...). The handler fetches the full activity from
  `/api/v3/activities/{object_id}` using the per-athlete access token
  looked up via `external_user_id = owner_id`.
- Idempotent on retries: `(source, external_id)` uniqueness on
  `workouts` plus the `superseded_by` matcher make duplicate webhook
  deliveries a no-op.
- Strava expects a 200 within ~2 seconds. The handler does the work
  inline; if latency becomes a problem we'd add a queue.

### Task 4.1: Webhook verification + event endpoints
**Files:**
- Create: `apps/web/app/api/webhooks/strava/route.ts` (GET + POST)
- Modify: `apps/web/lib/strava/activity-sync.ts` (extract per-activity helper)

**Steps:**
- `GET` reads `?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`,
  verifies `hub.verify_token` matches `STRAVA_WEBHOOK_VERIFY_TOKEN`,
  echoes `{ "hub.challenge": "<challenge>" }`. Returns 403 on mismatch.
- `POST` reads `{ object_type, object_id, aspect_type, owner_id }`.
  Ignores non-activity events. For `create`/`update`: looks up
  `user_integrations` by `external_user_id`, refreshes token, fetches
  the single activity, calls `processStravaActivity` (extracted from
  the batch loop). For `delete`: ack 200 (no auto-delete for now).
  Unknown `owner_id` → ack 200 (could be another tenant on this app).
- Extract the per-activity loop body in `syncStravaActivities` into
  `processStravaActivity(supabase, { userId, activity, existingWorkouts })`
  returning `'inserted' | 'linked' | 'alreadyPresent' | 'failed'`. Both
  the batch sync and the webhook handler call it.

### Task 4.2: Subscription registration endpoint
**Files:**
- Create: `apps/web/app/api/strava/register-webhook/route.ts`

**Steps:**
- Auth-scoped (`getAuthenticatedUserId()`). This is admin tooling —
  any signed-in athlete can register/clear the subscription for the
  app since there's only one.
- `GET` returns the current subscription (from
  `GET https://www.strava.com/api/v3/push_subscriptions?client_id=&client_secret=`).
- `POST` deletes any existing subscription first, then registers a
  new one with `callback_url=https://<host>/api/webhooks/strava` and
  `verify_token=<STRAVA_WEBHOOK_VERIFY_TOKEN>`. Returns the new
  subscription id.

### Task 4.3: Settings UI — Register webhook button
**Files:**
- Modify: `apps/web/components/integrations/strava-card.ts`
- Create: `apps/web/components/integrations/register-strava-webhook-button.tsx`

**Steps:**
- Small "Register webhook" client wedge next to "Sync now" when
  Strava is connected. POSTs to `/api/strava/register-webhook`.
  Surfaces success/error inline.

### Task 4.4: Tests
**Files:**
- Create: `apps/web/tests/strava-webhook-route.test.ts`
- Create: `apps/web/tests/strava-register-webhook-route.test.ts`
- Modify: `apps/web/tests/strava-activity-sync.test.ts` (verify the
  refactored batch path still inserts/links/idempotents correctly).

### Task 4.5: CLAUDE.md
- Add `/api/strava/register-webhook` to auth-scoped routes list.
- Add `/api/webhooks/strava` to the intentional-exception list with
  the verify-token + owner_id mapping rationale (mirrors the Oura/Strava
  callback exception block).
- New env var: `STRAVA_WEBHOOK_VERIFY_TOKEN`.
- Mark Phase 4 done in open work #4.

---

## Out of scope (deliberate, post-Phase-4)

- Strava webhook handler graduating to a background queue if the
  inline sync ever exceeds ~2s. For a single athlete this is unlikely.
- Auto-delete of workouts when `aspect_type='delete'` — defer until
  the UX implications are clearer.
- Webhook signature verification beyond `verify_token` — Strava
  doesn't currently sign the POST body. The verify_token guards the
  registration handshake; the POST is implicitly trusted because the
  `owner_id` mapping fails closed for unknown athletes.
