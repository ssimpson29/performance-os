# Auth-Scoping Browser-Driven Routes Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Convert all five browser-driven import/sync API routes from
caller-supplied `userId` to authenticated-session-derived athlete id, so two
athletes signed into the same deployment cannot read or write each other's
data through browser flows.

**Architecture:** Adopt `@supabase/ssr` for cookie-based session reading in
App Router server contexts. Introduce a small `lib/server-auth.ts` primitive
exposing `getAuthenticatedUserId()` and `getAuthenticatedUser()` that wraps a
per-request Supabase server client built from `next/headers` cookies.
Existing service-role usage in `lib/supabase-server.ts` stays — that client
is for trusted server-only writes (e.g. signed Apple Health push), not for
browser request handling. Convert the five routes from CLAUDE.md's auth-scoping
list to call the primitive, return 401 when unauthenticated, and always use
the resolved athlete id when working with persistence helpers. Update every
existing route test to mock the auth primitive instead of asserting on
caller-supplied userId behavior, and add the four required test cases per
route from CLAUDE.md's Testing Approach.

**Tech Stack:** Next.js 15 App Router (`next/headers` cookies), `@supabase/ssr`,
existing `@supabase/supabase-js`, Vitest 4.

**Out of scope:** `POST /api/imports/apple-health/push` stays signed-URL +
HMAC. `/api/imports/oura/callback` stays state-based (Oura's redirect doesn't
carry our auth cookies; the state parameter is bound to the connect-time
session and verified there).

---

## Required Scott handoff: install before any code can run

`@supabase/ssr` is not currently a dependency and the sandbox cannot reach
the npm registry. After this plan's package.json edit ships, Scott must run:

```powershell
cd C:\Users\scott\OneDrive\Documents\Claude\Projects\performance-os
npm install
```

Without this step, every later task will fail at module resolution.

---

### Task 1: Add @supabase/ssr to apps/web/package.json
**Objective:** Land the dependency add as its own diff so the install step is reviewable.

**Files:**
- Modify: `apps/web/package.json`

**Step 1:** Add `@supabase/ssr` to `dependencies` at a current minor.
**Step 2:** Scott runs `npm install` to update the lockfile.
**Step 3:** Verify `apps/web/node_modules/@supabase/ssr/package.json` exists locally.

### Task 2: Build lib/server-auth.ts primitive
**Objective:** Expose a single tested helper for "who is signed in right now?"

**Files:**
- Create: `apps/web/lib/server-auth.ts`
- Create: `apps/web/tests/server-auth.test.ts`

**Step 1:** Implement `createRequestSupabaseClient()` using
`createServerClient` from `@supabase/ssr`, sourcing cookies from
`next/headers`. Use `NEXT_PUBLIC_SUPABASE_URL` +
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (anon key path, not service role).

**Step 2:** Implement `getAuthenticatedUser()` returning the user or null
based on `supabase.auth.getUser()`.

**Step 3:** Implement `getAuthenticatedUserId()` as a convenience returning
`user?.id ?? null`.

**Step 4:** Tests covering:
- returns null when no auth cookies are present
- returns the authenticated user when `supabase.auth.getUser()` resolves a session
- returns null when the underlying getUser call errors
- `getAuthenticatedUserId` reduces to `id` from `getAuthenticatedUser`

The tests will use `vi.mock('@supabase/ssr', ...)` and `vi.mock('next/headers', ...)` so we don't need a real cookie jar.

### Task 3: Convert POST /api/imports/training-plan
**Objective:** First production conversion to validate the pattern.

**Files:**
- Modify: `apps/web/app/api/imports/training-plan/route.ts`
- Modify: `apps/web/tests/training-plan-persistence.test.ts` (only if it touches the route — keep persistence-level tests untouched)
- Create or modify: `apps/web/tests/training-plan-route.test.ts`

**Step 1:** Replace `formData.get('userId')` with
`await getAuthenticatedUserId()`. Return 401 when unauthenticated.

**Step 2:** Pass the resolved id to `persistImportedTrainingPlan` and any
downstream caller. Do not read `userId` from the form even as a fallback.

**Step 3:** Add the four tests from CLAUDE.md's Testing Approach:
1. 401 when not signed in.
2. Uses authenticated athlete id when signed in.
3. Ignores `userId` if present in form data.
4. Happy path still succeeds and returns the existing parsedSummary / adaptivePreview / persisted payload.

### Task 4: Convert POST /api/imports/workouts
**Objective:** Same pattern, JSON-body route.

**Files:**
- Modify: `apps/web/app/api/imports/workouts/route.ts`
- Modify: `apps/web/tests/workout-import-route.test.ts`

**Step 1:** Remove `userId` from the parsed body type. Authenticate via
`getAuthenticatedUserId()`.

**Step 2:** Update existing tests so they no longer pass `userId` and instead
mock the auth helper. Add the four required test cases.

### Task 5: Convert POST /api/imports/apple-health
**Objective:** Same pattern, formData route. The /push variant stays signed-URL — do not touch it.

**Files:**
- Modify: `apps/web/app/api/imports/apple-health/route.ts`
- Modify: `apps/web/tests/apple-health-import-route.test.ts`

**Step 1:** Replace `formData.get('userId')` with authenticated id.

**Step 2:** Update the "Missing userId" test to "401 unauthenticated"; add the other three required tests.

### Task 6: Convert GET /api/imports/oura/connect
**Objective:** OAuth handoff using the authenticated id in `state`.

**Files:**
- Modify: `apps/web/app/api/imports/oura/connect/route.ts`
- Modify: `apps/web/tests/oura-connect-route.test.ts`

**Step 1:** Replace `url.searchParams.get('userId')` with
`getAuthenticatedUserId()`. Return 401 when unauthenticated (do not redirect
unauthenticated users into Oura).

**Step 2:** Always embed the authenticated id in the OAuth `state` (no more
"oura-import" fallback for unauth flows).

**Step 3:** Confirm `/api/imports/oura/callback` (out of scope here) still
parses the `state` value correctly. No callback changes expected.

**Step 4:** Update tests.

### Task 7: Convert POST /api/sync/oura
**Objective:** Last route in the list.

**Files:**
- Modify: `apps/web/app/api/sync/oura/route.ts`
- Modify: `apps/web/tests/oura-sync-route.test.ts`

**Step 1:** Replace `body.userId` with authenticated id. Pass it through to `syncOuraRecovery`.

**Step 2:** Update tests; add the four required cases.

### Task 8: Update CLAUDE.md status
**Objective:** Flip the convention from aspirational to current.

**Files:**
- Modify: `CLAUDE.md`

**Step 1:** Remove the "Status (2026-05-21): target convention, not yet
implemented." block in the Athlete Identity Scoping section.

**Step 2:** Restore the past-tense "Routes converted to auth-scoped:"
phrasing, now accurate.

**Step 3:** Remove or close out Open Work item #5.

### Task 9: Verify
**Objective:** Run the full DoD.

**Files:**
- No code changes.

**Step 1:** `npm run test --workspace @performance-os/web` — all green
(38 existing + ~24 new = ~62 tests).

**Step 2:** `npm run typecheck` — clean.

**Step 3:** `npm run build` — clean.

**Step 4:** Commit + push, referencing Open Work #5 (now closed).

---

## Pitfalls to watch

1. **Don't read env at module top level in server-auth.ts** (CLAUDE.md pitfall #3). Read inside the helpers so tests can override `process.env` freshly.

2. **`@supabase/ssr` cookie set/remove inside route handlers needs the response object.** Read-only `get` is enough for our use case. If we ever need refresh-on-read, that's a follow-up.

3. **The Oura connect route is a redirect, not a JSON route.** Return a 401 NextResponse for unauthenticated callers instead of redirecting them into Oura — otherwise an attacker can drive any signed-out browser into an OAuth flow.

4. **Existing route tests pass `userId` and assert on "Missing userId" 400s.** Each conversion will break those tests; rewrite, don't delete.

5. **Persistence layer (`persistImportedTrainingPlan`, `importActualWorkouts`, `syncOuraRecovery`) still requires `userId` as input.** Those signatures stay; the routes just resolve the id from auth instead of the request body.

## What this plan deliberately doesn't do

- It does not add session-cookie issuance from the magic-link route. That route uses Supabase's built-in OTP flow; the auth cookie is set on the redirect to `/settings/integrations` by Supabase's own machinery once `@supabase/ssr` is wired. If magic-link sessions don't stick after install, that's a follow-up.
- It does not touch `/api/imports/apple-health/push` (stays HMAC signed URL).
- It does not touch `/api/imports/oura/callback` (stays state-based).
