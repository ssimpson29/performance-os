# Performance OS — Two-Coach Architecture

Performance OS runs two distinct LLM-driven coaching agents on top of a
shared deterministic engine and a single athlete data layer. They have
separate purposes, time horizons, and data sources, but feed each other.

This document is the higher-level mental model. For role-naming details
see `docs/llm-agent-roles.md`. For the deterministic engine see
`apps/web/lib/training-plan/` and (future) `apps/web/lib/longevity/`.

---

## The two coaches

### 1. Training Coach (adaptive, daily)

**Question it answers:** *"What should I do today?"*

- **Time horizon:** today → next 7 days → race date.
- **Primary inputs:**
  - Active `training_plans` row (race date, goal, `metadata.weeklyStructure`, `metadata.phaseBlocks`, `metadata.raceContext`).
  - Last 7–14 days of completed workouts (Apple Health, Strava, manual).
  - Recovery signals: Oura HRV, sleep, readiness.
  - `daily_summaries.summary.coachFollowUp` (active injury/strain windows).
- **Core logic:**
  - **Deterministic layer** — `apps/web/lib/training-plan/adaptive-coach.ts`. Race phase calculation, weekly load progression, fatigue state, follow-up window enforcement. Pure, tested, never broken.
  - **LLM layer** — `apps/web/lib/agents/training-coach.ts` (to build). Adds judgment, conversational rationale, athlete-facing language. Falls back to deterministic when `AI_COACH_*` env is missing.
- **Outputs:**
  - `training_recommendation` (top-line action for today).
  - `coachRationale` + `coachCautions` + `coachRecommendations` (persisted in `daily_summaries.summary`).
  - `coachFollowUp` (3-day-easy / 4-day-check-in windows on injury reports).
  - `health_events` row when strain/injury reported (`event_type='injury'`, `metadata.source='coach_message'`).
- **Cadence:** every session load, every athlete message, every new workout/recovery import.

### 2. Longevity Guru (strategic, weekly/monthly)

**Question it answers:** *"What matters most for my long-term health right now?"*

- **Time horizon:** weeks → years → lifetime.
- **Primary inputs:**
  - Biomarker history (blood work, lab panels).
  - Health history + family history.
  - Long-term trend data: resting HR, HRV baselines, body composition, sleep architecture, weight.
  - Lifestyle context: travel, stress, work load, supplements, medications.
  - Aggregated training load (from Training Coach's domain) — used as *one* input, not the primary one.
- **Core logic:**
  - **Deterministic layer** — biomarker thresholds, age-adjusted reference ranges, trend detection (improving / stable / degrading).
  - **LLM layer** — evidence-informed prioritization, narrative explanation, behavior-change framing.
- **Outputs:**
  - Prioritized longevity actions (top 1–3 levers right now).
  - Biomarker storytelling: what's moving, why, what to do.
  - Flags when training load conflicts with longevity goals (e.g., chronic overreach blunting recovery).
- **Cadence:** triggered on new lab uploads, weekly review, or athlete query. **Not** every workout.

---

## How they're distinguishable

| Dimension | Training Coach | Longevity Guru |
| --- | --- | --- |
| Time horizon | Days → race | Months → decades |
| Trigger | Every workout / message | Lab upload, weekly review, query |
| Primary signal | Load, recovery, plan adherence | Biomarkers, trends, health history |
| Output type | "Do this workout today" | "Prioritize this lever this quarter" |
| Tolerance for hard pushes | High (race-driven) | Low (sustainability-driven) |
| File location | `lib/training-plan/` + `lib/agents/training-coach.ts` | `lib/longevity/` + `lib/agents/longevity-guru.ts` |

---

## How they work together

1. **Shared data layer.** Both read from the same Supabase tables: `users`, `training_plans`, `workouts`, `oura_recovery`, `daily_summaries`, `health_events`, and `biomarkers` (longevity-specific, to be built).
2. **Shared athlete identity.** Both use `getAuthenticatedUserId()` — never trust caller-supplied IDs. The signed-URL push exception applies only to the Apple Health automation push route.
3. **Cross-influence:**
   - **Longevity Guru → Training Coach.** Longevity context becomes a constraint. If biomarkers show chronic inflammation or a sustained HRV trend down, Longevity Guru writes a "recovery-priority" flag to `daily_summaries.summary.longevityContext` that the Training Coach reads as a downgrade input.
   - **Training Coach → Longevity Guru.** Aggregated training load and injury history become longevity inputs. Excessive training stress over weeks shows up in Longevity Guru's prioritization (e.g., "back off mileage for the next block — recovery markers degrading").
4. **Conflict resolution rule.** When the two disagree (Training Coach wants intensity, Longevity Guru wants recovery), **longevity wins for sustained signals** (HRV trending down 4+ weeks, biomarkers degrading), **training wins for acute race-prep needs** (taper, sharpening). The conflict itself is surfaced to the athlete with rationale from both — never silently overridden.
5. **Single UI surface, two voices.** The `/coach` page shows daily action (Training Coach). The `/longevity` page shows strategic priorities (Longevity Guru). Both reference the other when relevant ("Your Longevity Guru is also flagging X — read more →").

---

## Training Coach behavior — design intent

The training plan is a **baseline**, not a ceiling or a floor. The Training
Coach reads the active plan's race date, goal, weekly structure, phase
blocks, and race context, and then continuously decides whether to hold,
push, or back off based on what the athlete's body is actually showing.

### Worked example 1 — adapt up on healthy over-performance

> Six-month plan for Swiss Alps 100, goal is "place as high as possible"
> (not just finish). Three months in, athlete is consistently pushing
> workouts longer and harder than the plan prescribes while HRV, resting
> HR, sleep, and intra-session heart rate response stay healthy.

The Training Coach must recognize that the athlete is **under-stressed
relative to capacity for the goal** and progressively raise the plan's
weekly targets to extract more peak performance — without crossing into
overreach. Specifically:

- Detect: prescribed vs. actual delta on volume/intensity is positive and
  recovery markers (HRV baseline, sleep architecture, resting HR) are
  stable or improving across a rolling window (e.g., 3+ weeks).
- Decide: increment the next block's load targets within phase-appropriate
  bounds; preserve the deload weeks; never raise during the taper phase.
- Rationale: surface to the athlete *why* the plan is being raised
  (vitals are healthy + plan goal is performance-based, not completion).
- Persist: write the adapted weekly targets so the plan-vs-actual view
  reflects the new baseline.

### Worked example 2 — adapt down on lagging adherence

> Three months in, athlete is consistently under-hitting prescribed
> volume / intensity, or workouts show degrading recovery (heart rate
> drift, slower paces, declining HRV, poor sleep).

The Training Coach should:

- Detect: prescribed vs. actual delta is negative across the window OR
  recovery markers are trending the wrong way.
- Decide: temporarily lower targets, preserve aerobic base work, defer
  intensity until recovery normalizes.
- Communicate: ask the athlete *why* if it's not obvious from data
  (illness, work stress, sleep loss, life event). The coach is not just
  a recommender — it's a conversational partner.

### Worked example 3 — conversational injury management

> Athlete reports "my left foot is hurting after my long run today."

The Training Coach must:

- **Ask follow-up questions** to triangulate the issue: where exactly,
  sharp vs. dull, weight-bearing vs. not, recent shoe change, mileage
  ramp, pain-free baseline, similar history.
- **Alter the plan for the next 2–4 days** — substitute cross-training,
  cap mileage, defer high-impact work. The deterministic layer enforces
  the easy-through window (`coachFollowUp.easyThroughDate = today + 3`).
- **Schedule a re-evaluation** — `coachFollowUp.checkInDate = today + 4`.
  On the check-in date the UI surfaces a prompt: "How's the foot?"
- **Return to the normal plan** when the athlete's responses are
  adequate (pain-free, full range of motion, normal gait). Use the
  positive-recovery phrase check before the generic negative match
  (CLAUDE.md pitfall #1: "pain free" contains "pain").
- **Persist** an `health_events` row with `event_type='injury'`,
  `metadata.source='coach_message'`, and the structured triage data so
  Longevity Guru can see it in long-term trend analysis.

### Worked example 4 — race-phase awareness

The Training Coach reads `training_plans.end_date` and the
`phaseBlocks` in metadata to know what week it is and which phase the
athlete is in. Behavior changes by phase:

- **Base build / foundation:** raising load on healthy vitals is
  in-bounds. Adding intensity is conservative.
- **Specific load / peak specificity:** intensity becomes core. Volume
  raises slow. Recovery sensitivity climbs.
- **Taper:** no raises. Plan is the ceiling. Coach defends the taper
  against athlete impulse to "do more."
- **Race week:** plan is the floor *and* ceiling. Deviations are
  flagged loudly.

---

## North star

- Training Coach optimizes for the Swiss Alps 100 race on August 7, 2026.
- Longevity Guru optimizes for decades of healthspan past the race.
- Both serve the higher-order goal: peak performance now without trading
  future health to get it.

---

## Status: built vs. to-build (as of 2026-05-21)

Future readers: do not assume the architecture above is implemented just
because it's described. Here's the honest current state.

**Built.**
- `daily_summaries` table with `longevity_priority` (text), `training_recommendation` (text), and `summary` (jsonb).
- `health_events` table.
- `lib/agents/contracts.ts` defines `LlmAgentRole = 'training-coach' | 'longevity-guru'` (typed but not implemented).
- `lib/training-plan/` deterministic engine: parser, expansion, adaptive-coach (weekend-overload heuristic only), plan-matching, workout-ingestion, persistence.
- `training_plans` persists `end_date`, `goal`, `metadata.{weeklyStructure, phaseBlocks, supportTemplates, raceContext}` (action 1, commit 2eb0588).
- Auth-scoping primitive (`lib/server-auth.ts`) and all five browser-driven import/sync routes converted (Open Work #5 closed).

**Not built yet.**
- `lib/agents/training-coach.ts` (the LLM-layer Training Coach service).
- `lib/longevity/` directory and `lib/agents/longevity-guru.ts`.
- `biomarkers` table and biomarker ingestion path. Longevity Guru's primary input has no system of record yet.
- `daily_summaries.summary.coachFollowUp` is a documented convention but the writer/reader code paths haven't been verified end-to-end.
- `daily_summaries.summary.longevityContext` is the cross-write mechanism described above; field is unallocated.
- Race-aware adaptation in `lib/training-plan/adaptive-coach.ts` (Open Work #3). The current engine only handles weekend-overload → Monday/Tuesday downgrade. The four worked examples above are the spec for the upgrade.
- `/longevity` page surface.
