# Longevity Guru Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build the second LLM-driven coaching agent — the Longevity Guru —
that answers "what matters most for my long-term healthspan right now?"
using biomarker history, long-term trends, and health/family history.
Establish the data layer it needs, the deterministic reference-range +
trend-detection engine, the LLM service with deterministic fallback, the
cross-write into `daily_summaries.summary.longevityContext` that the
Training Coach reads as a constraint, and the `/longevity` page surface.

**Architecture:** Mirror the existing Training Coach's 3-layer pattern.
A deterministic core in `lib/longevity/` evaluates biomarker values against
age-adjusted reference ranges and classifies trends (improving / stable /
degrading). An LLM service in `lib/agents/longevity-guru.ts` consumes the
deterministic output plus health history, lifestyle context, and
aggregated training load to produce prioritized longevity actions and
narrative explanations. The LLM is optional — when `AI_COACH_*` env is
missing, the deterministic layer's prioritization stands on its own.
Cadence is on-demand (lab upload, weekly review, athlete query) — never
per-workout. Two cross-influence channels: Longevity Guru writes a
`longevityContext` flag into `daily_summaries.summary` that the Training
Coach reads as a downgrade input, and reads aggregated training load /
injury history out of the same table family for its own analysis.

**Tech stack:** Supabase (Postgres), `@supabase/supabase-js`, Next.js 15
App Router, TypeScript 5.8 strict, Vitest 4, optional OpenAI-compatible
LLM provider via `AI_COACH_*` env.

**Out of scope:** This plan does not build a clinical decision support
system. It produces prioritization and narrative, not diagnosis. It does
not handle file-format-specific lab parsing beyond CSV / JSON / Quest /
LabCorp paste — broader ingest is a follow-up. It does not modify the
Training Coach's deterministic engine; that's `adaptive-coach.ts` work
under Open Work #3.

**See also:** `docs/two-coach-architecture.md` for the higher-level
mental model, conflict resolution rule, and the relationship between
the Training Coach and Longevity Guru.

---

## Prerequisites and required Scott handoffs

- Two-coach architecture doc (`docs/two-coach-architecture.md`) committed
  alongside this plan in the same PR.
- Open Work item #3 (race-aware adaptive coach) does **not** block this
  plan. The two are independent and can proceed in parallel, though
  shipping #3 first gives the Training Coach side of cross-influence
  earlier signal to write back to the longevity layer.
- LLM provider env (`AI_COACH_API_KEY`, `AI_COACH_MODEL`,
  `AI_COACH_BASE_URL`) is optional — implementation must work with
  deterministic fallback.

---

### Task 1: Schema — `biomarkers` and `biomarker_panels` tables

**Objective:** Establish a system of record for lab results.

**Files:**
- Create: `supabase/migrations/007_longevity_schema.sql`
- Modify: `supabase/README.md` if a schema docs file exists

**Step 1:** `biomarker_panels` table:
- `id uuid pk default gen_random_uuid()`
- `user_id uuid not null references public.users(id) on delete cascade`
- `panel_date date not null` — date the sample was drawn (not uploaded)
- `source text not null` — `'quest'` / `'labcorp'` / `'manual'` / `'home_test'`
- `lab_name text` — free text (lab provider name)
- `notes text` — athlete or clinician notes on the panel as a whole
- `raw_payload jsonb` — original parsed upload
- `metadata jsonb not null default '{}'::jsonb`
- standard `created_at` / `updated_at`

**Step 2:** `biomarkers` table:
- `id uuid pk default gen_random_uuid()`
- `panel_id uuid not null references public.biomarker_panels(id) on delete cascade`
- `user_id uuid not null references public.users(id) on delete cascade`
- `marker_key text not null` — normalized key (e.g. `'apob'`, `'hba1c'`, `'ldl_c'`, `'hs_crp'`, `'fasting_glucose'`, `'total_testosterone'`)
- `display_name text not null`
- `value numeric not null`
- `unit text not null` — `'mg/dL'`, `'mmol/L'`, `'%'`, `'ng/mL'`, etc.
- `flag text` — `'low'` / `'in_range'` / `'high'` (from the deterministic layer; nullable on insert)
- `reference_low numeric` — age/sex-adjusted (snapshot at insert time)
- `reference_high numeric`
- `metadata jsonb not null default '{}'::jsonb`
- standard timestamps
- index: `(user_id, marker_key, panel_date)` for trend queries

**Step 3:** RLS — match existing pattern from `005_rls.sql`. Both tables
restricted to `user_id = auth.uid()`. Add an explicit policy for the
service-role-key path (server-side writes from ingestion routes).

**Step 4:** Add `longevity_context jsonb` column to `daily_summaries` —
this is the cross-write target. (Alternative: continue to nest under
`summary.longevityContext` as the architecture doc proposes. Choose one
in implementation review. The dedicated column is queryable; the nested
key keeps schema changes minimal. Default: nested in `summary`.)

### Task 2: Reference-range catalog + age/sex-adjustment

**Objective:** Encode evidence-informed reference ranges so the
deterministic layer can flag values without an LLM call.

**Files:**
- Create: `apps/web/lib/longevity/reference-ranges.ts`
- Create: `apps/web/tests/longevity-reference-ranges.test.ts`

**Step 1:** Define a typed catalog keyed on `marker_key`. Each entry has:
- canonical units
- general adult reference range
- age-stratified overrides (e.g. men 40+ testosterone, women postmenopause)
- "optimal" range (longevity-leaning, tighter than clinical reference)
- evidence citation as a `note` string (not validated, just for traceability)

**Step 2:** Implement `evaluateMarker({ markerKey, value, unit, age, sex })`
returning `{ flag, reference: { low, high }, optimal: { low, high } | null, rationale }`.

**Step 3:** Tests cover:
- Marker not in catalog → returns `flag: 'in_range'` with `reference: null` and `rationale: 'unknown_marker'`.
- Unit mismatch → throws (caller must normalize first).
- Age band boundary cases — e.g. age 39 vs. 40 for men's testosterone.
- "Optimal" tighter than "in_range" — value in clinical reference but outside optimal returns `flag: 'in_range'` with non-null `optimal` and a `rationale` calling it suboptimal.

### Task 3: Trend detection over time

**Objective:** Classify biomarker movement as improving / stable / degrading.

**Files:**
- Create: `apps/web/lib/longevity/trend-detection.ts`
- Create: `apps/web/tests/longevity-trend-detection.test.ts`

**Step 1:** Implement `detectMarkerTrend(history: { date: string, value: number }[], markerKey: string)`
returning `{ direction: 'improving' | 'stable' | 'degrading', magnitude: 'minor' | 'moderate' | 'major', confidence: number, rationale: string }`.

**Step 2:** Rules:
- "Improving" direction depends on the marker (e.g. higher HDL is improving; lower ApoB is improving). The reference catalog carries a `desiredDirection: 'high' | 'low' | 'middle'` field.
- Need at least 3 data points across at least 3 months to call `'major'` magnitude.
- Confidence is a function of sample count, time span, and signal-to-noise (variance vs. mean change).
- A single outlier doesn't flip a trend — use a moving window.

**Step 3:** Tests cover:
- Improving trend on a "lower is better" marker (e.g. ApoB).
- Improving trend on a "higher is better" marker (e.g. HDL).
- Stable trend with high variance — should be `'stable'` with low confidence.
- Single-outlier resistance — three good values, one bad, still `'stable'` not `'degrading'`.
- Two-point history — never returns `'major'`.

### Task 4: Deterministic prioritization engine

**Objective:** Produce the top 1–3 longevity levers without an LLM, given
current biomarker flags + trends + recent training load + health history.

**Files:**
- Create: `apps/web/lib/longevity/prioritization.ts`
- Create: `apps/web/tests/longevity-prioritization.test.ts`

**Step 1:** Implement `prioritizeLongevityActions(input)` returning an
ordered list of levers, each with `{ leverKey, severity, recommendation, rationale, evidence }`.

**Step 2:** Lever taxonomy (initial set, extensible):
- `metabolic_health` — HbA1c, fasting glucose, fasting insulin, ApoB
- `cardiovascular_health` — Lp(a), ApoB, hs-CRP, BP, RHR
- `inflammation` — hs-CRP, ferritin, lifestyle drivers
- `hormonal_health` — testosterone (sex-adjusted), thyroid panel, SHBG
- `body_composition` — DEXA results, BMI as a weak signal
- `recovery_capacity` — sustained HRV trend, RHR trend, sleep efficiency
- `training_load_overreach` — fed by Training Coach's aggregated load

**Step 3:** Ranking heuristics:
- Severity = how far outside optimal + trend direction (degrading >> stable >> improving).
- Tie-break by lever priority weighting (cardiovascular and metabolic above hormonal for general adults; configurable per-user later).
- Cap output at 3 levers; the rest are surfaced as "watching."

**Step 4:** Tests cover:
- Single high-severity lever returns alone.
- Two equally severe levers — both surface, deterministic tie-break.
- "Improving" trends de-prioritize that lever even if value is outside optimal.
- Training-load overreach signal (from Training Coach domain) ranks above purely metabolic when sustained 4+ weeks.

### Task 5: Longevity Guru LLM service

**Objective:** Wrap the deterministic core with an LLM layer for narrative
prioritization, behavior-change framing, and athlete-facing language.

**Files:**
- Create: `apps/web/lib/agents/longevity-guru.ts`
- Modify: `apps/web/lib/agents/contracts.ts` (add input/output types for the longevity role)
- Create: `apps/web/tests/longevity-guru.test.ts`

**Step 1:** Define `LongevityGuruInput` (typed): athlete profile (age, sex,
health history, family history), recent biomarker panel + history, current
trends, recent training load summary, optional athlete question.

**Step 2:** Define `LongevityGuruOutput` (typed): `levers: Array<{ key, severity, recommendation, rationale, sources }>`, `narrative: string`, `cautions: string[]`, `conflictsWithTraining: Array<{ leverKey, description }>`, `longevityContext: { recoveryPriority: 'low' | 'normal' | 'elevated', notes: string }`.

**Step 3:** Implement `runLongevityGuru(input)`:
- Always run the deterministic layer first (`prioritizeLongevityActions`).
- If `AI_COACH_*` env present, call the LLM with the deterministic output as ground truth and ask for narrative + behavior framing.
- If env missing or LLM call fails, return a deterministic-only response with a flat narrative built from rationales.

**Step 4:** Tests cover the deterministic-fallback path (no env, no
network) and the LLM happy path (mocked LLM). LLM prompt content is not
asserted line-by-line; assert the shape and that deterministic levers
flow through.

### Task 6: Cross-write `longevityContext` into `daily_summaries`

**Objective:** Let the Training Coach see the Longevity Guru's
recovery-priority signal without re-running anything.

**Files:**
- Create: `apps/web/lib/longevity/persistence.ts`
- Create: `apps/web/tests/longevity-persistence.test.ts`

**Step 1:** Implement `persistLongevityRun({ userId, output })`. It:
- Upserts a row in `daily_summaries` for `(user_id, day = today)`.
- Merges `output.longevityContext` into `summary.longevityContext`,
  preserving other keys (e.g. `coachConversation`, `coachFollowUp`).
- Updates `longevity_priority` (text column) to a one-line summary of
  the top lever.

**Step 2:** Tests cover the merge-without-clobber behavior, especially:
existing `summary.coachFollowUp` stays intact when `summary.longevityContext` is added.

**Step 3:** Modify `lib/training-plan/adaptive-coach.ts` (or its data
loader, depending on layering) to read `summary.longevityContext` and
treat `recoveryPriority: 'elevated'` as a downgrade input. Add tests
under `adaptive-coach.test.ts` covering: longevity flag elevates →
Monday downgrade even on light weekend; longevity flag normal → no
change to existing behavior.

### Task 7: API route — `POST /api/longevity/evaluate`

**Objective:** Athlete-triggered Longevity Guru run.

**Files:**
- Create: `apps/web/app/api/longevity/evaluate/route.ts`
- Create: `apps/web/tests/longevity-evaluate-route.test.ts`

**Step 1:** Auth-scoped via `getAuthenticatedUserId()` from `lib/server-auth.ts`. Return 401 unauthenticated. (Add to CLAUDE.md's auth-scoping list when this lands.)

**Step 2:** Body accepts an optional `question` string and an optional `forceRefresh: boolean`.

**Step 3:** Load athlete profile + recent panels + trends + recent training-load summary; pass to `runLongevityGuru`; persist via `persistLongevityRun`; return the output.

**Step 4:** Tests cover the four required cases: 401, uses authed id, ignores caller-supplied userId, happy path.

### Task 8: API route — `POST /api/imports/biomarker-panel`

**Objective:** Ingestion path for lab results.

**Files:**
- Create: `apps/web/app/api/imports/biomarker-panel/route.ts`
- Create: `apps/web/lib/longevity/ingestion.ts`
- Create: `apps/web/tests/biomarker-panel-route.test.ts`

**Step 1:** Accept JSON payload `{ panelDate, source, labName?, notes?, markers: [{ markerKey, displayName, value, unit }] }`.

**Step 2:** Normalize units against the reference catalog (mg/dL ↔ mmol/L conversions for cholesterol panels at minimum). Evaluate each marker via `evaluateMarker` and persist with snapshotted reference range.

**Step 3:** Auth-scoped via `getAuthenticatedUserId()`. Same four tests pattern.

**Step 4:** Out of scope: parsing PDF/HTML lab reports. The first-cut payload is a manual JSON dump, paste-from-portal, or a simple CSV-to-JSON helper in the UI.

### Task 9: UI surface — `/longevity` page

**Objective:** Make the Longevity Guru visible.

**Files:**
- Create: `apps/web/app/longevity/page.tsx`
- Create: `apps/web/app/longevity/data.ts` (athlete-scoped data loader)
- Modify: `apps/web/app/coach/page.tsx` (add a one-line cross-link "Your Longevity Guru is flagging X →")

**Step 1:** Load the most recent Longevity Guru output for the
authenticated athlete plus the latest biomarker panel.

**Step 2:** Render top levers with rationale, the narrative, conflict
notes, and a "trigger re-evaluation" button that POSTs to
`/api/longevity/evaluate`. Surface the most recent biomarker movements
(improving / stable / degrading) with sparkline-style trend indicators.

**Step 3:** Add a "Recent labs" table.

**Step 4:** Cross-link to `/coach` for context on training conflicts.

**Step 5:** Tests — `plan-page.test.tsx` style, lightweight, asserting
the page renders the expected sections given a sample fixture.

### Task 10: CLAUDE.md updates

**Objective:** Reflect the new convention surface.

**Files:**
- Modify: `CLAUDE.md`

**Step 1:** Add `POST /api/longevity/evaluate` and `POST /api/imports/biomarker-panel` to the auth-scoped routes list.

**Step 2:** Update "Coach memory persistence" section to document `summary.longevityContext` shape.

**Step 3:** Update Architecture diagram (or text) to include
`lib/longevity/`, `lib/agents/longevity-guru.ts`, and `app/api/longevity/`.

**Step 4:** Close any Open Work item that's superseded by this work.

### Task 11: Verify

**Objective:** Full DoD pass.

**Files:** None (verification only).

**Step 1:** `npm run test --workspace @performance-os/web` — all green.

**Step 2:** `npm run typecheck` — clean.

**Step 3:** `npm run build` — clean.

**Step 4:** Manually exercise the flow once locally:
- Upload a synthetic biomarker panel via `/api/imports/biomarker-panel`.
- Trigger `/api/longevity/evaluate`.
- Confirm `daily_summaries.summary.longevityContext` is set for today.
- Reload `/coach` — confirm the Training Coach picks up the longevity flag.
- Reload `/longevity` — confirm the panel + levers render.

**Step 5:** Commit + push.

---

## Pitfalls to watch

1. **Reference-range catalog scope creep.** This plan ships with a small
   evidence-informed set of markers (ApoB, LDL-C, HDL-C, triglycerides,
   HbA1c, fasting glucose, fasting insulin, hs-CRP, Lp(a), testosterone,
   ferritin, TSH, free T3/T4, vitamin D, omega-3 index). Adding more
   markers is a follow-up — keep the initial catalog tight.

2. **"Optimal" vs. "in range" must be distinct.** Clinical reference
   ranges are bounded by disease, not by longevity. The catalog needs
   both, and the prioritization engine must surface "in range but not
   optimal" as a real lever, not silence it.

3. **LLM prompts go on a rolling diet.** As the deterministic layer
   gets stronger, the LLM's role narrows toward narrative and framing.
   Don't let the LLM re-prioritize against the deterministic engine —
   it should respect the ranking and explain it, not override it.
   (Mirror the Training Coach's deterministic-is-truth pattern.)

4. **Conflict resolution must be surfaced, not silenced.** When the
   Longevity Guru flags recovery-priority and the Training Coach wants
   intensity, the UI must show both perspectives with the resolution
   rule applied (`docs/two-coach-architecture.md` §"Conflict resolution
   rule"). Never auto-override silently.

5. **Athlete identity scoping.** Every new route auth-scopes via
   `getAuthenticatedUserId()`. Add the four standard tests per route.
   Do not pattern off pre-conversion routes.

6. **Don't query "latest" panel/biomarker globally** (CLAUDE.md pitfall
   #6). Always scope to athlete.

---

## What this plan deliberately doesn't do

- Does not parse PDF / HTML lab reports. Manual paste / JSON / CSV only.
- Does not build genetic / methylation / proteomic ingestion.
- Does not introduce wearable continuous-data ingestion beyond what
  Oura already provides.
- Does not implement notifications (email / push when a lever shifts).
  That's a follow-up once the surface is real.
- Does not implement Longevity Guru → Training Coach feedback beyond
  the `longevityContext` flag. Deeper cross-talk (e.g. injecting
  biomarker-derived constraints into the deterministic adaptive-coach
  decision tree) is reserved for after both agents are shipped and the
  cross-write is observed in real use.
