# Training Import + Adaptive Coach Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build the first working slice of training-plan import and baseline adaptive coaching for Performance OS.

**Architecture:** Parse coach-authored Excel workbooks into normalized app-facing structures, persist plan records into Supabase, and expose adaptation logic that treats weekly structure as the base while adjusting daily recommendations using recent completed workload. Keep v1 simple: preserve raw workbook semantics, normalize the Swiss Alps 100 structure, and implement transparent heuristics for Monday/Tuesday adaptation after overloaded weekends.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, XLSX parser, Vitest.

---

### Task 1: Add test/runtime dependencies
**Objective:** Add parser and test support.

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`

**Step 1:** Add `xlsx` and `vitest`.
**Step 2:** Add `test` script for web workspace.
**Step 3:** Verify install completes.

### Task 2: Add workbook fixture and parser tests
**Objective:** Lock expected workbook behavior before writing parser code.

**Files:**
- Create: `apps/web/tests/fixtures/Swiss Alps 100.xlsx`
- Create: `apps/web/tests/training-plan-parser.test.ts`

**Step 1:** Write tests asserting parser returns:
- four sheet names
- weekly structure days (Monday-Sunday)
- phase blocks
- support templates from Daily / Strength Days / Speed Warmup
- fuel targets and notes preserved

**Step 2:** Run tests and confirm they fail.

### Task 3: Implement parser module
**Objective:** Normalize workbook into app data structures.

**Files:**
- Create: `apps/web/lib/training-plan/types.ts`
- Create: `apps/web/lib/training-plan/parser.ts`

**Step 1:** Create typed domain structures.
**Step 2:** Implement workbook parsing for Swiss Alps workbook shape.
**Step 3:** Re-run parser tests.

### Task 4: Add adaptation tests
**Objective:** Specify coaching behavior before implementation.

**Files:**
- Create: `apps/web/tests/adaptive-coach.test.ts`

**Step 1:** Write tests for examples like:
- back-to-back long intense Saturday/Sunday workouts
- Monday downgraded to recovery/rest
- Tuesday quality downgraded or deferred when recovery debt remains
- normal weekend load keeps baseline weekly structure

**Step 2:** Run tests and confirm they fail.

### Task 5: Implement baseline adaptive coach
**Objective:** Build transparent heuristics for first-pass workout adaptation.

**Files:**
- Create: `apps/web/lib/training-plan/adaptive-coach.ts`

**Step 1:** Score recent workload using duration, intensity, and back-to-back density.
**Step 2:** Map fatigue state to adjusted recommendations.
**Step 3:** Re-run adaptation tests.

### Task 6: Add import persistence path
**Objective:** Save parsed plan to Supabase in a coherent v1 shape.

**Files:**
- Create: `apps/web/lib/training-plan/persistence.ts`
- Create: `apps/web/app/api/imports/training-plan/route.ts`

**Step 1:** Accept uploaded workbook.
**Step 2:** Parse it.
**Step 3:** Insert one `training_plans` row.
**Step 4:** Insert baseline `planned_sessions` weekly structure rows.
**Step 5:** Preserve phases, support templates, and raw workbook summaries in `metadata`.

### Task 7: Surface the feature in the UI
**Objective:** Make the new capability visible in Plan page.

**Files:**
- Modify: `apps/web/app/plan/page.tsx`
- Modify: `apps/web/lib/sample-data.ts`

**Step 1:** Show imported-plan concepts.
**Step 2:** Show adaptive-coach example for overloaded weekend.

### Task 8: Verify
**Objective:** Ensure the feature works and doesn’t break the scaffold.

**Files:**
- No code changes required.

**Step 1:** Run parser tests.
**Step 2:** Run adaptation tests.
**Step 3:** Run full `npm run typecheck`.
**Step 4:** Run `npm run build`.
