# iOS / Xcode Action List

Living checklist of work that requires a Mac with Xcode. Scott uses a
friend's Mac intermittently — this doc batches the work so each Mac
session can knock through the queue in one sitting.

## How to use this file

- "Next session" is in priority order. Top item is highest priority.
- When you complete an item, move it to "Done" with the date and a one-line
  note on outcome.
- New work that needs Mac access goes into "Next session" or "Later"
  (rough triage by urgency).
- Steps that don't strictly require a Mac but are most efficiently done in
  the same sitting as Mac work are tagged `(Mac-adjacent)`.

---

## Next session (in order)

### 1. Regenerate signed Apple Health push URL  *(Mac-adjacent)*

Doesn't technically require a Mac — any browser signed into production
works. Bundled here because the URL is only useful when paired with the
AppConfig integration below.

- Sign in to https://performance-os-seven.vercel.app.
- Visit `/settings/integrations`.
- Copy the displayed signed Apple Health push URL.
- Keep it in your password manager or a local note (not in chat or
  anywhere git-tracked) until step 2.

### 2. Create `AppConfig.local.swift` on the Mac

A gitignored secrets file the tracked `AppConfig.swift` falls through to.
Lives alongside `apps/ios/PerformanceOS/App/AppConfig.swift` but is
excluded from git.

- Create `apps/ios/PerformanceOS/App/AppConfig.local.swift` with:

  ```swift
  import Foundation

  extension AppConfig {
      /// Local-only override of the signed Apple Health push URL.
      /// This file is gitignored — never commit it.
      static let signedAppleHealthPushURLOverride: String? =
          "https://performance-os-seven.vercel.app/api/imports/apple-health/push?userId=...&signature=..."
  }
  ```

  Paste the URL from step 1 into the string literal.

- Verify `.gitignore` already excludes this file (added in step 3 of this
  list). If you create the file before step 3 lands, double-check `git
  status` does NOT show `AppConfig.local.swift` as untracked-to-be-added
  before committing anything else.

### 3. Modify tracked `AppConfig.swift` to fall through to the override

Make `AppConfig.appleHealthPushURL` prefer `signedAppleHealthPushURLOverride`
when it's defined (i.e., when `AppConfig.local.swift` is present).

- The tracked file currently has placeholder values
  (`REPLACE_ME` / LAN IP). After this change it should:
  - Read `AppConfig.signedAppleHealthPushURLOverride` if defined.
  - Otherwise fall back to a placeholder that crashes with a clear error
    message on launch, so you can't accidentally ship without the local
    override in place.

- Suggested shape (write on the Mac and verify it compiles):

  ```swift
  import Foundation

  enum AppConfig {
      static var signedAppleHealthPushURLString: String {
          if let override = signedAppleHealthPushURLOverride {
              return override
          }
          preconditionFailure(
              "Missing AppConfig.local.swift. See docs/ios-todo.md item #2."
          )
      }

      static var signedAppleHealthPushURLOverride: String? { nil }

      // ... rest of AppConfig (appleHealthPushURL, apiBaseURL, manualSyncFallbackDays)
  }
  ```

- The `signedAppleHealthPushURLOverride` declaration in the tracked file is
  the fallback (`nil`). The override in `AppConfig.local.swift` shadows it
  with the real value. Swift allows this via extension; if it doesn't,
  promote both to a single `static var` and have `AppConfig.local.swift`
  reassign at module-init time — confirm pattern works in Xcode.

- Add `AppConfig.local.swift` to `.gitignore` (under the existing iOS
  section, or create one):
  ```
  apps/ios/PerformanceOS/App/AppConfig.local.swift
  ```

### 4. Add the three test files to `PerformanceOS.xcodeproj`

Uploaded files not yet in the project:
- `PerformanceOSTests.swift`
- `PerformanceOSUITests.swift`
- `PerformanceOSUITestsLaunchTests.swift`

In Xcode: right-click the test target group in the project navigator →
**Add Files to "PerformanceOS"…** → select the three files → ensure
"Copy items if needed" is checked, target membership is the test target
(not the app target). Run the test target locally to confirm they compile.

### 5. HealthKit capability + Info.plist usage description

- In Xcode: select the `PerformanceOS` target → **Signing & Capabilities**
  tab → **+ Capability** → add **HealthKit**.
- Open `Info.plist` for the app target. Add the key
  `NSHealthShareUsageDescription` with a value like:
  `"Performance OS reads your workouts from HealthKit to keep your training plan and Coach in sync."`
- Both items are tracked in the May 5 plan
  (`docs/plans/2026-05-05-iphone-first-app-mvp.md`, task 8).

### 6. Smoke-test sync from Xcode against production

With AppConfig.local.swift in place pointing at the production signed URL:

- Build + run the app on a physical iPhone (HealthKit is unavailable in
  the simulator for workout data).
- Authorize HealthKit when prompted.
- Tap the "Sync now" button in `SyncSettingsView`.
- Expect: success status, no 401.
- Verify in Supabase (SQL editor on the project):
  ```sql
  select id, source, external_id, workout_type, started_at, local_date
  from workouts
  where user_id = '<your-user-id>'
  order by created_at desc
  limit 5;
  ```
  A new row should appear.

### 7. Verify idempotency

- Tap "Sync now" again immediately.
- Expect: no new `workouts` rows for the same `(source, external_id)`.
  Ingestion pipeline already enforces this; confirming end-to-end here.

### 8. Replace `WorkoutSyncService.live` smoke-test payload with real HealthKit reader

Currently `WorkoutSyncService.live` hardcodes a single sample workout.
Task 10 of `docs/plans/2026-05-05-iphone-first-app-mvp.md` is to wire
`HealthKitWorkoutReader.fetchWorkouts(since:)` into the service so
real workouts flow through. Files:

- `apps/ios/PerformanceOS/Services/WorkoutSyncService.swift` — replace
  hardcoded payload with reader query, sorting, and POST.
- `apps/ios/PerformanceOS/Storage/SyncStateStore.swift` — update
  `lastSuccessfulSyncAt` only after a 200.

Run step 6 and 7 again to confirm real workouts sync without
duplicates.

---

## Later (lower priority)

### Decide `PerformanceOS.xcodeproj` tracking policy

Three options, pick one in a future session:

1. **Track it.** Commit the whole `.xcodeproj` directory. Pros: source
   target / test target / signing settings / capabilities are recorded.
   Cons: project file generates merge conflicts on any structural change
   from Xcode; diffs are noisy.
2. **Gitignore it.** Each Mac session regenerates the project from
   tracked source. Pros: no noise. Cons: target membership, build
   settings, capabilities, schemes all have to be re-applied every
   session — expensive given intermittent Mac access.
3. **Track a subset.** Track `project.pbxproj` only and gitignore
   `xcuserdata/`, `*.xcworkspace/xcuserdata/`. This is the standard
   compromise. Pros: project structure tracked, user-specific state
   ignored. Cons: still binary-ish diffs on pbxproj changes.

Recommend option 3 long-term. Add to `.gitignore`:
```
apps/ios/PerformanceOS.xcodeproj/xcuserdata/
apps/ios/PerformanceOS.xcodeproj/project.xcworkspace/xcuserdata/
```

### iOS 401 investigation — fallback path

If after rotation + new signed URL the iOS Swift client still returns 401:

- Use iPhone Shortcuts to hit the same signed endpoint (CLAUDE.md Open
  Work #1 workaround) — that validates the signature pipeline without
  needing Xcode time. Steps:
  1. Open Shortcuts on iPhone.
  2. Create a new shortcut with a "Get Contents of URL" action.
  3. Set method POST, URL = the full signed URL, headers
     `Content-Type: application/json`, body = `{"workouts":[]}`.
  4. Run it. A 200 confirms the signature pipeline is healthy and the
     bug is in the Swift client. A 401 confirms the secret/URL pairing
     is the problem and tells you to retrace steps 1–6 of the rotation.

### Replace the rented Mac dependency

Open question: when the iOS work matures, consider buying time on
macOS Cloud / MacInCloud or borrowing a Mac more consistently. Tracked
here as a parking-lot item, not actionable until iOS is closer to
real release.

---

## Done

### 2026-05-21 — Rotated `APPLE_HEALTH_PUSH_SECRET` in Vercel

- Generated new 64-char hex secret via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- Updated `APPLE_HEALTH_PUSH_SECRET` in Vercel project Environment
  Variables (Production).
- Redeployed via Deployments tab.
- Confirmed the previous signed URL returns
  `{"error":"Invalid Apple Health push signature"}` with a 401.
- The previous signed URL is dead. The new signed URL needs to be
  regenerated from `/settings/integrations` (item #1 above) the next
  time a Mac session is planned.

Reason: previous signed URL was pasted into chat / upload context and
was treated as compromised regardless of access intent. The repo was
public at the time of exposure; rotating closes the window.

