# iPhone-First App MVP Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Create the first native iPhone client for Performance OS, focused on HealthKit workout sync, daily athlete surfaces, and reuse of the existing Supabase/web backend.

**Architecture:** Keep the current backend as the system of record. Build a native SwiftUI iPhone app that reads HealthKit workouts, syncs them to the existing Apple Health push endpoint, and becomes the primary athlete interface over time. Keep the first slice narrow: native app shell, HealthKit authorization, workout sync, local sync state, and a simple Today/Recovery/Plan tab scaffold.

**Tech Stack:** SwiftUI, HealthKit, URLSession, UserDefaults, existing Next.js/Supabase backend.

---

### Task 1: Create the iPhone app workspace scaffold
**Objective:** Add repo structure and developer docs for a native iPhone app.

**Files:**
- Create: `apps/ios/README.md`
- Create: `apps/ios/PerformanceOS/App/PerformanceOSApp.swift`
- Create: `apps/ios/PerformanceOS/App/ContentView.swift`
- Create: `apps/ios/PerformanceOS/App/AppConfig.swift`

**Step 1:** Add an iOS app README describing scope, Xcode setup, and why the backend remains separate.
**Step 2:** Create the SwiftUI app entry point and root tab shell.
**Step 3:** Add app config holding the local dev base URL and signed Apple Health push URL placeholder.

### Task 2: Add sync domain models
**Objective:** Define stable types for HealthKit → backend workout sync.

**Files:**
- Create: `apps/ios/PerformanceOS/Models/WorkoutPayload.swift`
- Create: `apps/ios/PerformanceOS/Models/WorkoutSyncRequest.swift`
- Create: `apps/ios/PerformanceOS/Models/SyncState.swift`

**Step 1:** Add Codable payload structs matching the existing `/api/imports/apple-health/push` contract.
**Step 2:** Add local sync state for `lastSuccessfulSyncAt`, `lastAttemptAt`, and status.
**Step 3:** Add a stable derived external ID fallback rule.

### Task 3: Add API client
**Objective:** Create a reusable networking layer for workout sync.

**Files:**
- Create: `apps/ios/PerformanceOS/Services/APIClient.swift`
- Test: future Xcode unit test target `apps/ios/PerformanceOSTests/APIClientTests.swift`

**Step 1:** Build a URLSession-based POST helper for JSON requests.
**Step 2:** Add a `pushAppleHealthWorkouts` call that posts to the signed endpoint.
**Step 3:** Surface readable errors for unreachable server, bad payloads, and non-200 responses.

### Task 4: Add HealthKit authorization + workout reader
**Objective:** Read workouts natively instead of relying on Shortcuts.

**Files:**
- Create: `apps/ios/PerformanceOS/Services/HealthKitWorkoutReader.swift`
- Modify later in Xcode: app entitlements and Info.plist health usage descriptions

**Step 1:** Request read access for workouts and related workout statistics.
**Step 2:** Query workouts since `lastSuccessfulSyncAt` with a sensible fallback window.
**Step 3:** Map HKWorkout values into the existing backend payload shape.

### Task 5: Add workout sync orchestration
**Objective:** Turn raw HealthKit reads into safe repeated syncs.

**Files:**
- Create: `apps/ios/PerformanceOS/Services/WorkoutSyncService.swift`
- Create: `apps/ios/PerformanceOS/Storage/SyncStateStore.swift`

**Step 1:** Load the last sync state.
**Step 2:** Read recent workouts from HealthKit.
**Step 3:** POST them to the backend endpoint.
**Step 4:** Persist the updated sync state only after success.
**Step 5:** Make repeated runs safe and idempotent.

### Task 6: Add athlete-facing status UI
**Objective:** Give the athlete a simple native command surface.

**Files:**
- Create: `apps/ios/PerformanceOS/ViewModels/SyncStatusViewModel.swift`
- Create: `apps/ios/PerformanceOS/Features/Settings/SyncSettingsView.swift`
- Create: `apps/ios/PerformanceOS/Features/Today/TodayView.swift`
- Create: `apps/ios/PerformanceOS/Features/Recovery/RecoveryView.swift`
- Create: `apps/ios/PerformanceOS/Features/Plan/PlanView.swift`

**Step 1:** Show HealthKit permission status.
**Step 2:** Show last sync time and last error.
**Step 3:** Add a manual “Sync now” button.
**Step 4:** Keep the initial tabs lightweight and clearly marked as native scaffold screens.

### Task 7: Add scheduled/background sync plan
**Objective:** Define the Apple-side automation path for recurring updates.

**Files:**
- Create: `apps/ios/PerformanceOS/Docs/background-sync-notes.md`

**Step 1:** Document expected cadence: midday + evening sync.
**Step 2:** Describe likely implementation path: foreground catch-up first, background refresh next.
**Step 3:** Call out iOS constraints so the design stays realistic.

### Task 8: Create Xcode project and verify on a Mac
**Objective:** Turn the scaffold into a runnable app in the correct environment.

**Files:**
- Create on macOS: `apps/ios/PerformanceOS.xcodeproj`
- Modify on macOS: entitlements, signing, bundle settings

**Step 1:** Open the `apps/ios` folder in Xcode on a Mac.
**Step 2:** Create the project using the scaffolded source files.
**Step 3:** Add HealthKit entitlements and privacy strings.
**Step 4:** Run on a real iPhone and verify a manual sync succeeds.

### Task 9: Verify end-to-end
**Objective:** Confirm the iPhone app can keep the backend current.

**Files:**
- No repo code changes required beyond prior tasks.

**Step 1:** Authorize HealthKit access.
**Step 2:** Run one manual sync.
**Step 3:** Verify `workouts` rows appear in Supabase.
**Step 4:** Verify `/plan` updates with matched workouts.
**Step 5:** Verify repeat syncs do not duplicate the same workout rows.
