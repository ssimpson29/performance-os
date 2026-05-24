# Longevity Guru — conversational mode (2026-05-23)

## Problem

The Longevity Guru today is single-shot. The athlete uploads labs at
`/longevity/import`, hits "Re-evaluate now" on `/longevity`, gets a
narrative + priorities. No way to ask follow-ups ("explain my apoB,"
"what about a statin?", "why does the guru disagree with my training
coach on Tuesday quality?"). The training coach has full multi-turn
chat at `/coach`; longevity has one-way prose.

Soul Phase 2 was left explicit in the soul PR: refactor the guru to
a tool-calling loop and let it also write to the longevity soul.

## Goal

Athlete can chat with the Longevity Guru the same way they chat with
the Training Coach. Multi-turn, tool-calling, persisted. The guru
reads the athlete's biomarker history, the soul (Attia/Saladino
framing), recent injuries, and the deterministic prioritization
engine on demand. It can also write to the longevity soul as
durable facts emerge.

The existing single-shot `/api/longevity/evaluate` + "Re-evaluate now"
button stay — useful for "just re-score my labs after I upload a new
panel." The chat surface is **additive**.

## Architecture

### Two modes, one agent

`lib/agents/longevity-guru.ts` keeps `runLongevityGuru(input)` unchanged
(single-shot evaluation). New module `lib/agents/longevity-chat.ts`
exports `runLongevityChat(input)` — multi-turn agent loop pattern
copied from `lib/agents/training-coach.ts`. Both share the system
prompt builder (`buildSystemPrompt(soul?)`, already exported).

### Tool registry

New `lib/agents/longevity-tools.ts` — separate from `coach-tools.ts`
so each agent has tool descriptions tuned to its audience. Tools:

- `getRecentBiomarkers` — latest panel, all marker evaluations with
  flag / optimalDelta / trend / rationale. Same shape as coach tool
  but the description is longevity-flavored.
- `getMarkerHistory({ markerKey })` — every prior value for a single
  marker, dated, so the guru can answer "how has my apoB moved over
  time?"
- `getLongevitySoul` — read the current soul.
- `updateLongevitySoul({ content })` — overwrite the longevity soul.
  Description warns to preserve existing facts. Author tagged
  `'longevity_guru'` (the `soul_author` enum from migration 010
  already supports it).
- `getInjuryHistory` — same as coach tool; some longevity questions
  ("am I overtraining?") want this data.
- `runDeterministicPrioritization` — runs the existing
  prioritization engine over the athlete's markers + trainingLoadOverreach,
  returns priorities + watching + conflictsWithTraining. Gives the
  LLM a structured way to ground its narrative in the engine's
  output rather than re-deriving priorities from scratch every turn.

### Conversation persistence

`daily_summaries.summary.longevityConversation` — mirrors
`coachConversation`. Array of `{ role: 'athlete' | 'guru', text, at }`.
Last 20 messages survive across day rollovers (the row keys on
`(user_id, day)`, so we read the most recent row regardless of day,
same pattern the training coach uses).

`AthleteContext.longevityConversation` added so both agents see each
other's context if needed (the longevity guru can know the athlete
just told the coach about a foot injury). Loaded in parallel by
`loadAthleteContext`.

New persister `lib/agents/longevity-chat-persistence.ts` mirrors
`training-coach-persistence.ts`:
- Merges into `daily_summaries.summary` without clobbering
  `coachConversation`, `longevityContext`, `todaysCall`, etc.
- Inserts a new `longevity_priority` row update if the guru's
  narrative materially changes priorities (single-shot path also
  writes this; chat path does NOT re-prioritize unless the LLM
  explicitly calls `runDeterministicPrioritization`).

### API endpoint

`POST /api/longevity/message` — mirrors `/api/coach/message`:
- Auth-scoped, rate-limited (10/min same as coach).
- Body: `{ message: string }`.
- Loads `AthleteContext`, calls `runLongevityChat`, persists, returns
  `{ message, conversation, soulUpdated, llmInvoked, toolTrace }`.

### UI

Extend `/longevity` page. New client component `longevity-chat.tsx`
parallels `coach-chat.tsx`:
- Renders below the existing priorities + narrative.
- Conversation thread on top, textarea at the bottom.
- Optimistic athlete message append, server reply replaces the
  optimistic entry when the response lands.
- Same styling vocabulary as coach-chat for consistency.

### Backward compat

- `runLongevityGuru` unchanged.
- `/api/longevity/evaluate` + "Re-evaluate now" button unchanged.
- `longevitySoul` continues to be writable by the athlete via /account.
- All existing tests in `tests/longevity-*.test.ts` keep passing.

## Tests

- `tests/longevity-chat.test.ts` — env-missing deterministic
  fallback, happy-path tool calls mocked, conversation history
  shaping.
- `tests/longevity-message-route.test.ts` — 401, validates payload,
  persists conversation, returns expected shape.
- `tests/longevity-tools.test.ts` — getMarkerHistory dispatch,
  updateLongevitySoul attribution as `longevity_guru`,
  runDeterministicPrioritization wrapper returns the existing
  engine output.

## CLAUDE.md

- Update the existing "Longevity Guru" architecture section: dual
  mode (single-shot + chat).
- New "Longevity Guru conversation" convention section: persistence
  shape, tool registry, soul write attribution.
- New Open Work entry #9 documenting the PR.

## Out of scope

- Tool-calling for `runLongevityGuru` single-shot path. Keep it
  simple; the chat path is where the tool loop earns its keep.
- Cross-agent handoffs (athlete asks the training coach a longevity
  question or vice versa). Each surface stays focused on its lane.
