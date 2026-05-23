# Onboarding + coach-driven plan creation (2026-05-23)

## Problem

A new athlete signing into Performance OS today has no path from
"created an account" to "talking to the coach about a real plan." The
coach can't reason about the athlete (no height/weight/experience),
there's no flow that captures profile data, and even if the athlete
talks to the coach, the coach has no tool to record what it learns. The
plan page assumes a workbook has already been imported.

## Goal

A first-time athlete signs in, fills a short profile form, and lands in
the coach chat. The coach reads the profile, asks for any gaps, pulls
recent Apple / Strava data for a fitness baseline, drafts a plan via
the existing `proposeRacePlan` tool, gets explicit approval, commits it,
and the athlete sees the plan on `/plan` — current week highlighted,
full plan visible week by week.

Both forms of input — UI form for the basics, conversational gap-fill
through the coach — must write to the same `users` columns and
`health_events` table so the athlete never re-enters anything.

## Schema (migration 009_onboarding_profile.sql)

Add to `public.users`:

- `primary_goal text` — free text. Examples: "Place top 10 at Swiss Alps 100,
  August 2026"; "Finish my first half marathon"; "Stay healthy through age 60."
  Drives `inferCoachingPosture` for plans the athlete builds later.
- `experience_level text check (experience_level in ('beginner','building','experienced'))`.
  Mirrors the `proposeRacePlan` input. Defaults to `'building'` for
  athletes who skip the field.
- `weekly_training_hours_baseline numeric(5,2)` — athlete's typical
  weekly training time over the last 4–8 weeks. Used by the coach to
  anchor `proposeRacePlan.currentFitness.weeklyMileageKm` (multiply by
  10 km/hr easy pace) when Strava/Apple data is missing or thin.
- `health_notes text` — free-text catch-all for chronic conditions /
  meds / allergies / surgeries the coach should know about.
- `onboarding_completed_at timestamptz` — null until the athlete submits
  the form. Middleware gate uses this.

RLS already covers `users` via `005_rls.sql`. No new policies needed.

Past injuries are captured as `health_events` rows with
`event_type='injury'` and `metadata.source='onboarding'` — same table
the coach already writes to from chat messages.

## Profile read/write surface

`apps/web/lib/profile/profile-loader.ts`

```ts
export type AthleteProfile = {
  userId: string;
  displayName: string | null;
  timezone: string | null;
  dateOfBirth: string | null;
  sex: 'male' | 'female' | null;
  heightCm: number | null;
  weightKg: number | null;
  primaryGoal: string | null;
  experienceLevel: 'beginner' | 'building' | 'experienced' | null;
  weeklyTrainingHoursBaseline: number | null;
  healthNotes: string | null;
  onboardingCompletedAt: string | null;
};

export async function loadAthleteProfile(
  supabase: SupabaseClient, userId: string,
): Promise<AthleteProfile>;
```

`apps/web/lib/profile/profile-writer.ts`

```ts
export type AthleteProfilePatch = Partial<Omit<AthleteProfile, 'userId' | 'onboardingCompletedAt'>>;

/**
 * Partial update. Only writes fields present in the patch — any field
 * left undefined is preserved. Used by the onboarding API and by the
 * coach's recordAthleteProfile tool for conversational gap-fill.
 */
export async function upsertAthleteProfile(
  supabase: SupabaseClient,
  userId: string,
  patch: AthleteProfilePatch,
): Promise<AthleteProfile>;

/**
 * Sets onboarding_completed_at = now() in the same transaction as the
 * final profile patch from the onboarding form. Separate function so
 * the coach's gap-fill writes (which happen post-onboarding) don't
 * accidentally re-stamp the completion timestamp.
 */
export async function markOnboardingComplete(
  supabase: SupabaseClient, userId: string,
): Promise<void>;
```

`AthleteContext` (in `lib/agents/athlete-context.ts`) extended with
`profile: AthleteProfile`. Loaded in parallel with the other context
slices so the coach always has it.

## Coach tools

`apps/web/lib/agents/coach-tools.ts`:

- `getAthleteProfile` — returns the loaded profile slice. No args.
  Description tells the LLM to call this BEFORE asking the athlete
  for any profile field — half the time the answer is already on file.
- `recordAthleteProfile` — accepts a partial patch of profile fields
  and upserts via `upsertAthleteProfile`. The LLM uses this during
  gap-fill ("How tall are you?" → patch). All fields optional;
  validation happens server-side.

Both auth-scoped via `ctx.userId` in tool handler context.

## Onboarding flow

`apps/web/app/onboarding/page.tsx` — client component, 5 steps with
local React state and an in-page progress indicator:

1. **Basics.** display name (prefilled from auth), timezone (browser detect),
   date_of_birth, sex (male/female/skip), height_cm, weight_kg.
2. **Training history.** experience_level (beginner / building / experienced),
   weekly_training_hours_baseline, optional "longest recent run" hint
   (free text, fed to the coach later but not persisted as a column).
3. **Health.** Repeatable injury rows (body part + when + still-active?).
   Free-text health_notes textarea below.
4. **Goal.** primary_goal text (free text). Optional race name + date +
   distanceKm + elevationGainM if the athlete already has one — these
   get stashed in a session-storage handoff and offered to the coach
   as the first conversation seed (we don't auto-build a plan during
   onboarding; the coach drives that with the athlete in the loop).
5. **Connections.** Cards linking to `/settings/integrations` for
   Strava / Apple Health push URL / Oura. "Skip for now" button.

`POST /api/onboarding/complete` (auth-scoped):

```ts
type OnboardingCompletePayload = {
  profile: AthleteProfilePatch;
  injuries: Array<{
    bodyPart: string;
    startedAt: string;        // ISO date
    endedAt?: string;          // ISO date, undefined when still active
    notes?: string;
  }>;
  raceSeed?: {
    raceName: string;
    raceDate: string;
    distanceKm?: number;
    elevationGainM?: number;
  };
};
```

Handler:
1. `upsertAthleteProfile(supabase, userId, payload.profile)`
2. Insert each injury into `health_events` with
   `event_type='injury'`, `metadata.source='onboarding'`,
   `metadata.bodyPart=...`.
3. `markOnboardingComplete(supabase, userId)`
4. Return `{ ok: true, raceSeed: payload.raceSeed ?? null }` so the
   client can pass `raceSeed` along to the coach via query param.
5. Client redirects to `/coach?seed=race` (or `/coach` when no seed)
   and the coach page reads the seed from session storage on mount.

Errors short-circuit with a 400 + an explanation; the form keeps the
user in place so they can correct.

## Middleware redirect

`apps/web/middleware.ts` already runs on every request to refresh
auth tokens. Extended logic:

- Skip for paths: `/onboarding`, `/api/`, `/auth/`, `/_next/`,
  `/favicon.ico`, static assets.
- For signed-in users only: query `users.onboarding_completed_at`. If
  null, return `NextResponse.redirect(new URL('/onboarding', request.url))`.

The query adds ~one round-trip per protected request. Acceptable for
v1; cache-on-cookie can come later.

## Coach prompt — new-athlete branch

Add to `buildSystemPrompt` (`lib/agents/training-coach.ts`):

> **New athlete with no plan.** When `getCurrentPlan` returns
> `{ plan: null }`, call `getAthleteProfile` first. If profile fields
> are missing or thin, ask 1–2 targeted questions per turn — never
> blast through them all. Use `recordAthleteProfile` to file each
> answer as you get it. Once profile is solid AND the athlete has
> named a race (or wants to build toward one), call `getRecentWorkouts`
> to anchor on real baseline fitness, then call `proposeRacePlan` with
> `currentFitness` derived from the workouts + profile, race details
> from the conversation, and `constraints.longRunDay` either from the
> athlete or the default (Saturday). Present the summary plainly,
> ASK for approval, and only call `commitTrainingPlan` after explicit
> "yes / commit it / go ahead."

`AthleteContext.profile` is also surfaced near the top of the prompt
(height, weight, age, experience, goal text) so the LLM has those at
hand without a tool call.

## Plan view — phase + scrollable week list

Extend `apps/web/app/plan/page.tsx` with a new section below the
current-week panel. Renders only when `phaseBlocks.length > 0` (which
is true for any plan imported via workbook or proposeRacePlan — both
write phaseBlocks):

For each phase block:
- Phase name header (e.g. "PHASE 2: SPECIFIC LOAD BUILD"), week count.
- A `<ul>` of weeks. Each `<li>` shows: week label, mileage target,
  vert target, key focus (when present), deload tag (when isDeload).
- The week matching `phasePosition.phaseIndex + weekIndexInPhase` is
  highlighted in `brand2` border.
- The week containing `raceDate` is marked "Race week."

Static render, no client JS — the data is already in `view.phaseBlocks`
which the page already loads. Cheapest path to "I can see my whole
plan and where I am in it."

## Tests

`tests/profile-loader.test.ts` — happy path, missing columns return null
fields, athlete with no row returns a profile shell with all-null fields
(must not throw — onboarding hasn't happened yet).

`tests/profile-writer.test.ts` — partial patch preserves other fields,
markOnboardingComplete sets timestamp.

`tests/coach-tools-profile.test.ts` — getAthleteProfile returns the
loaded slice; recordAthleteProfile applies patch + returns updated.

`tests/onboarding-complete-route.test.ts` — 401 unauth, validates
payload shape, upserts profile + inserts each injury + sets timestamp,
happy path returns `{ ok: true, raceSeed }`.

`tests/middleware.test.ts` — signed-in user with null
onboarding_completed_at + protected path → 307 to /onboarding.
Signed-in user with set timestamp passes through. Signed-out
user passes through (the page surfaces its own sign-in CTA).
Excluded path (/onboarding, /api/auth/magic-link, /auth/callback)
always passes.

`tests/training-coach-prompt.test.ts` (extend) — new-athlete branch
language present when `currentPlan: null` and `profile` is partial.

`tests/plan-page.test.tsx` (extend) — phase + week list renders
when phaseBlocks present; current week is highlighted.

## CLAUDE.md updates

New convention sections: "Athlete profile schema" (which columns,
which table), "Onboarding flow" (redirect rule + completion API +
form steps), "Plan view structure" (current-week vs full-plan list).
New Open Work entry documenting this PR.

## Out of scope (explicitly)

- Profile editing UI in `/settings/profile`. Coach gap-fill + the
  conversational nature of corrections covers v1. Revisit if athletes
  ask for it.
- Calendar / month grid view. The phase + week list is the v1 path;
  the grid is a follow-on workstream.
- Auto-build a plan during onboarding. The plan generator runs through
  the coach so the athlete is in the loop and can adjust.
- `recordInjuryHistory` tool. The form captures injuries during
  onboarding, and the existing regex-based injury detection from coach
  messages already writes to `health_events`. Coach gap-fill on past
  injuries can use `recordAthleteProfile` for `healthNotes` for now.
