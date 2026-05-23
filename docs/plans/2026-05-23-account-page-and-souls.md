# Account page + athlete souls (2026-05-23)

## Problem

Three connected gaps after onboarding shipped:

1. **No account page.** The 5-step onboarding form is the only way to
   write profile fields. After onboarding completes, the athlete has no
   way to view what's on file or correct it — they'd have to wipe
   `onboarding_completed_at` and walk the form again.
2. **No sign-in / sign-out in the header.** Auth is implicit (magic
   link from /settings/integrations). No "Sign out" anywhere in the
   app — the cookie just expires.
3. **No persistent memory across sessions.** The Training Coach and the
   Longevity Guru re-discover the athlete every turn. If Scott tells
   the coach "I follow Attia and Saladino — filter health advice
   through their views," that fact is lost as soon as the
   conversation rolls out of the 20-message window or `daily_summaries`
   gets a fresh day. The coach has no way to record durable facts.

## Goal

The athlete has a single `/account` page that shows profile + souls,
can edit either, and can sign out. The two LLM agents have access to
two long-form "soul" documents per athlete — one for training-coach
context, one for longevity-guru context — that persist across sessions
and across days. Soul content frames every response the agent gives.

## Architecture

### Souls — single markdown body per (athlete, kind) with audit

New table `public.athlete_souls`:

```sql
create type public.soul_kind as enum ('training', 'longevity');
create type public.soul_author as enum ('athlete', 'training_coach', 'longevity_guru');

create table public.athlete_souls (
  user_id uuid not null references public.users(id) on delete cascade,
  kind public.soul_kind not null,
  content text not null default '',
  updated_by public.soul_author not null default 'athlete',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, kind)
);
```

Plus an audit table that snapshots every prior version so accidental
overwrites are recoverable:

```sql
create table public.athlete_soul_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind public.soul_kind not null,
  content text not null,
  updated_by public.soul_author not null,
  recorded_at timestamptz not null default now()
);
create index athlete_soul_revisions_user_kind_recorded_idx
  on public.athlete_soul_revisions (user_id, kind, recorded_at desc);
```

RLS:
- `athlete_souls` — user can select / insert / update / delete their own.
- `athlete_soul_revisions` — user can select their own; insert allowed
  (audit writes happen server-side); no updates / deletes (revisions
  are immutable).

### Loader / writer

`apps/web/lib/profile/soul-loader.ts`

```ts
export type SoulKind = 'training' | 'longevity';
export type SoulAuthor = 'athlete' | 'training_coach' | 'longevity_guru';
export type AthleteSoul = {
  userId: string;
  kind: SoulKind;
  content: string;
  updatedBy: SoulAuthor;
  updatedAt: string | null;
};
export async function loadSoul(
  supabase: SupabaseClient, userId: string, kind: SoulKind,
): Promise<AthleteSoul>;
```

Returns an empty-content soul shell when no row exists yet. Never
throws on missing — souls are optional, an athlete might not have one
on day 1.

`apps/web/lib/profile/soul-writer.ts`

```ts
export async function updateSoul(
  supabase: SupabaseClient,
  args: { userId: string; kind: SoulKind; content: string; updatedBy: SoulAuthor },
): Promise<AthleteSoul>;
```

Three steps in a logical transaction (sequential — Supabase doesn't
have JS-side multi-statement transactions, so we accept the small
window where the snapshot exists but the upsert failed; that's
"orphan revision," harmless):

1. Load current content (for the snapshot).
2. Insert the OLD content into `athlete_soul_revisions` (so we always
   have the prior state if the new write is destructive).
3. Upsert `athlete_souls` with new content + `updated_by` + `now()`.

Idempotency: writing the same content as the current row is a no-op
(no revision row inserted, no `updated_at` bump). Avoids audit-table
churn when the LLM rewrites the soul with identical content.

### Coach reads — context + prompt injection

`AthleteContext` gets:

```ts
trainingSoul: AthleteSoul;
longevitySoul: AthleteSoul;
```

Both loaded in parallel by `loadAthleteContext`.

`buildSystemPrompt` (training coach) gets a new block near the top:

```
ATHLETE SOUL (training) — last updated 2026-05-22 by athlete:
<content>

ATHLETE SOUL (longevity) — last updated 2026-05-20 by longevity_guru:
<content>

These are durable facts about who the athlete is, what they value, and
what they've told you that should outlast any single conversation.
Read them every turn. Frame your response through them. When the
athlete shares a new durable fact (preference, value, doctor they
trust, recurring pattern, hard constraint), call updateTrainingSoul
to add it. Do NOT delete existing facts unless the athlete explicitly
contradicts or retracts one. When in doubt, keep + append.
```

Longevity guru's `buildSystemPrompt` gets the same souls injected with
parallel framing — but read-only in v1. The guru is single-shot
(no tool-calling loop yet); refactor is a Phase 2.

### Training coach tools

New in `lib/agents/coach-tools.ts`:

- `getTrainingSoul` — returns the training-soul content as-is so the
  LLM can confirm what's on file before editing.
- `updateTrainingSoul(content)` — overwrites the training-soul with
  `content`. Author = `'training_coach'`. Description warns the LLM
  to preserve existing facts and append rather than rewrite from
  scratch.

NOT added: longevity-soul write tool. The longevity soul is written by
the athlete via `/account` for v1. The guru reads it but doesn't write
it. (Phase 2: refactor guru to tool-calling loop and add
updateLongevitySoul there.)

### /account page

`apps/web/app/account/page.tsx` (server) loads:
- profile via `loadAthleteProfile`
- both souls via `loadSoul`
- sign-in state via `getAuthenticatedUser`

`apps/web/app/account/account-form.tsx` (client) renders:
- **Primary:** profile fields in a single-page form (not stepper —
  this is for editing, not first-time setup). Save button calls
  `PATCH /api/profile` which calls `upsertAthleteProfile`. Does NOT
  re-stamp `onboarding_completed_at`.
- **Secondary, collapsible:** "What your coaches remember about you"
  with two `<details>` blocks — training soul + longevity soul. Each
  has a markdown textarea + Save button. Save calls
  `PATCH /api/souls` with `{ kind, content }`. Author = `'athlete'`.

A "Sign out" button in the page footer (and in the nav header) calls
`POST /api/auth/signout`.

### Sign-in / sign-out + nav header

`POST /api/auth/signout` — auth-scoped: calls `supabase.auth.signOut()`
which clears the Supabase cookies, then `NextResponse.redirect('/')`.

`components/layout/app-header.tsx` extended:
- Adds `/account` to navigation (or makes it a separate trailing
  link, depending on space).
- Shows a "Sign in" link when no user, "Sign out" button when signed
  in. Server-fetches the auth user inline (it's already a server
  component).

`lib/site.ts` — `appConfig.navigation` extended with the `/account`
entry. Order: Plan / Coach / Longevity / Integrations / Account.

## API endpoints

- `PATCH /api/profile` (auth-scoped) — body: `AthleteProfilePatch`. Calls
  `upsertAthleteProfile`. Returns `{ ok: true, profile }`.
- `PATCH /api/souls` (auth-scoped) — body: `{ kind: SoulKind; content: string }`.
  Calls `updateSoul` with `updatedBy: 'athlete'`. Returns `{ ok: true, soul }`.
- `POST /api/auth/signout` (auth-scoped) — clears Supabase cookies via
  SSR client; redirects to `/`.

## Tests

- `tests/soul-loader.test.ts` — empty shell on missing row, returns
  populated row when present.
- `tests/soul-writer.test.ts` — happy path inserts revision + upserts
  content; identical-content write is a no-op (no revision insert).
- `tests/coach-tools-soul.test.ts` — getTrainingSoul returns content;
  updateTrainingSoul calls writer with `updatedBy: 'training_coach'`.
- `tests/training-coach-prompt.test.ts` (extend) — soul anchors in
  the prompt, "preserve existing facts" instruction.
- `tests/longevity-guru-prompt.test.ts` (new or extend existing) —
  longevity soul anchor in the prompt.
- `tests/profile-route.test.ts` — PATCH /api/profile, 401, validates,
  upserts.
- `tests/souls-route.test.ts` — PATCH /api/souls, 401, validates
  kind, calls writer.
- `tests/signout-route.test.ts` — calls signOut, redirects to /.
- `tests/account-page.test.tsx` (snapshot or assertion) — renders
  profile + collapsible souls when signed in; redirects when not.

## CLAUDE.md updates

New "Athlete souls" convention section. New Open Work entry #7
documenting the PR.

## Out of scope (explicitly)

- Longevity guru refactor to tool-calling loop with its own
  updateLongevitySoul tool. The athlete seeds the longevity soul via
  /account in v1, which covers the "I value Attia and Saladino"
  use case Scott called out. Phase 2.
- Soul diff / merge UI ("here's what the coach added since you last
  looked"). Audit table exists; UI is Phase 2.
- Markdown rendering in the read-only view. v1 renders as plain
  preformatted text; markdown rendering is Phase 2.
