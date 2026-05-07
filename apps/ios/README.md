# Performance OS iPhone App

This folder is the native iPhone client scaffold for Performance OS.

## Why native iPhone now
The web backend is already useful for:
- Oura sync
- plan import
- plan-vs-actual matching
- recovery persistence

But the athlete-facing product is Apple-centric:
- Apple Health
- Apple Watch workouts
- HealthKit permissions
- background refresh
- notifications

So the right architecture is:
- **native iPhone app = primary athlete client**
- **existing backend = data system of record**
- **web app = admin/debug/coach support surface**

## Current scope
This scaffold starts with the narrowest high-value slice:
1. authorize HealthKit workout reads
2. read recent workouts from Apple Health
3. push them to the existing backend endpoint
4. show sync status in a native SwiftUI shell

## Important constraint
This repo is being edited from WSL/Linux, so Jarvis can scaffold Swift source files and architecture, but **cannot generate or run an actual Xcode project here**.

To run the app you will need:
- a Mac with Xcode
- an Apple developer-capable local environment
- iPhone device or simulator

## Expected folder layout
```text
apps/ios/
  README.md
  PerformanceOS/
    App/
    Features/
    Models/
    Services/
    Storage/
    Docs/
```

## First-run setup on a Mac
1. Open Xcode.
2. Create a new iOS App project named `PerformanceOS` under `apps/ios/`.
3. Point the project at the existing source files in `apps/ios/PerformanceOS/`.
4. Enable HealthKit in Signing & Capabilities.
5. Add Health privacy strings to Info.plist.
6. Set the backend base URL and Apple Health push URL in `AppConfig.swift`.
7. Run on a real iPhone.

## Backend contract already in place
The iPhone app should post workouts to the existing backend route:

`POST /api/imports/apple-health/push`

Payload shape:
```json
{
  "workouts": [
    {
      "externalId": "stable-id",
      "workoutType": "Outdoor Run",
      "startedAt": "2026-05-05T14:00:00.000Z",
      "endedAt": "2026-05-05T15:05:00.000Z",
      "durationSeconds": 3900,
      "distanceMeters": 12000,
      "energyKcal": 850,
      "avgHeartRate": 148,
      "maxHeartRate": 171
    }
  ]
}
```

## Development priority
1. manual sync works on iPhone
2. repeat sync is idempotent
3. sync status UI is clear
4. scheduled/background sync is added after the manual path is solid
