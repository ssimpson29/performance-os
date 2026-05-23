# LLM-composed Today's Call (2026-05-23)

## Problem

`/coach` shows a "Today's Call" card. Until today it rendered the
plan's static weekly-structure template entry for that day — e.g.
"Long Run, 2.5–3 hrs building toward 4–5 hrs." That text is the
plan-import template, not a workout. It doesn't read:

- Where the athlete is in their phase progression
- The prescribed week from `phaseBlocks` (mileage / vert / focus)
- Recent workouts (was Thursday's vert hard? did I skip Tuesday?)
- Recovery (sleep / HRV / readiness)
- Coaching posture (aggressive should push, conservative should defend)
- Athlete soul context (preferences, recurring patterns)

So an athlete in Phase 2 week 5 with degrading Oura readiness and a
top-10 placement goal gets the same "Long Run 2.5–3 hrs" as someone in
Phase 1 week 1 with fresh legs and a finisher goal. Generic.

## Goal

The LLM PROACTIVELY composes today's specific workout when /coach
loads. Not the chat coach (that's reactive). A purpose-built
single-call composer that reads everything available and produces a
structured workout call with rationale.

## Design

### New module: `apps/web/lib/agents/todays-call.ts`

```ts
export type TodaysCall = {
  /** One-line workout title — "Long Run · 32mi with LT inserts" */
  headline: string;
  /** Session type — "Long Run" / "Quality" / "Recovery" / "Rest" */
  runSession: string;
  /** Free-text details of duration + structure */
  details: string;
  /** Exact prescription — pace targets, intervals, RPE */
  exactWork: string;
  /** Strength + mobility instructions (or "Skip lifting today") */
  strengthMobility: string;
  /** Fuel + hydration guidance */
  fuel: string;
  /** 1-2 sentence rationale referencing recent data + phase */
  rationale: string;
  /** "Phase 2: Specific Load Build · week 5 of 10 · 11 weeks to race" */
  phaseContext: string;
  /** ISO date when this call was composed */
  composedAt: string;
  /** Whether the LLM was invoked (false → deterministic fallback) */
  llmInvoked: boolean;
};

export async function composeTodaysCall(
  ctx: AthleteContext,
  supabase: SupabaseClient,
): Promise<TodaysCall | null>;
```

Returns null when AI_COACH_* env is missing OR athlete has no plan.

### Prompt design

Distinct from the chat coach prompt. Composer prompt:

- Frames the task: "Compose today's exact workout based on all
  available data. Output JSON only."
- Inlines: phase position, prescribed week from phaseBlocks (mileage,
  vert, focus, isDeload), today's base weekly-structure entry, last
  7 days of completed workouts (with descriptions / suffer scores /
  HR / pace), last 3 days of recovery, posture, profile summary,
  both souls.
- Hard rules: today is the workout being composed, not advice for
  next week. Be specific (cite pace targets, exact intervals). If
  recovery says back off, back off. If posture is aggressive AND
  recovery is good, push.
- Output: JSON matching TodaysCall (sans `composedAt` + `llmInvoked`
  which server fills).
- `response_format: { type: 'json_object' }` for parseable output.
- Tool access: same registry as chat coach so the LLM can call
  `runAdaptiveEngine`, `getRecentWorkouts`, `getRecentBiomarkers`,
  `getInjuryHistory` for deeper context if it wants.

### Cache

Composed call goes in `daily_summaries.summary.todaysCall` keyed by
athlete + day. First /coach load of the day composes fresh and
caches; subsequent same-day loads read from cache (~$0.02 saved per
read).

Invalidation: `persistTrainingCoachRun` clears the cached
`todaysCall` when a chat turn lands (so the next /coach load
recomposes with the new conversation context — injury reports,
recovery updates, "I'm handling more than the plan" reports). Cache
key on (athlete, day) — automatically rotates at midnight.

### Coach page render

`/coach` calls `composeTodaysCall(ctx, supabase)` server-side.

Card renders structured fields:
- Headline (h2)
- phaseContext as a small subhead under the date
- Details / Exact work / Strength&Mobility / Fuel as labeled rows
- Rationale as a smaller text block at the bottom

Fallback when composer returns null:
- Env missing → render the existing weeklyStructure entry + a small
  "AI call composition unavailable — showing base plan" note.
- No plan → existing "upload a plan" CTA.
- LLM failure → render base plan + log the error.

### Deterministic fallback

When the LLM is unavailable, the composer falls back to:
- Phase context from `computePhasePosition`
- Today's `weeklyStructure[day]` entry rendered as headline + details
- `runAdaptiveEngine` adapted recommendation for today (if any)
- A rationale of "Based on plan template + engine read; LLM
  composition not available right now."

Same TodaysCall shape, just less personalized. Athletes never see
a broken card.

## Schema

No schema change. `daily_summaries.summary.todaysCall` is new but
the column is JSONB; we just add a new key.

## Tests

- `tests/todays-call.test.ts` — composer happy path (mocked LLM
  returns valid JSON, parses correctly), env-missing returns null,
  malformed JSON throws, deterministic fallback when LLM fails.
- Cache + invalidation tests in
  `tests/training-coach-persistence.test.ts` (extend).
- Coach page test renders structured fields.

## CLAUDE.md

New convention section: "Today's Call composition" — describes
the proactive composer, the cache, the invalidation rules, the
structured shape, and the fallback chain.

## Out of scope

- "Tomorrow's preview" — composing tomorrow's workout the night
  before. Useful but separate UX problem.
- Streaming the composer output (it's a single shot, not chat).
- Multi-workout days (some plans have AM + PM sessions). Current
  output is one workout; if needed, the LLM can describe both in
  the `details` field.
