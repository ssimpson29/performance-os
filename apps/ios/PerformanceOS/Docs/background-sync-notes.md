# Background Sync Notes

## MVP stance
Start with **manual foreground sync** from the iPhone app.

That proves:
- HealthKit permissions work
- payload mapping is correct
- the backend endpoint is correct
- repeated syncs do not create duplicate workouts

## First recurring target
After manual sync works, add a recurring model that aims for:
- midday catch-up sync
- evening catch-up sync

## iOS reality
Background execution on iPhone is constrained.

Do not design around the assumption that iOS will let the app run on a perfect server-like schedule.

Use a layered approach instead:
1. foreground/manual sync always works
2. app-open catch-up sync
3. background refresh if/when reliable
4. optional notification nudges if the user has not synced recently

## Definition of success for v1
Even if background sync is imperfect, the product still wins if:
- workouts sync quickly when the app is opened
- the user can force sync with one tap
- repeated syncs are safe
- `/plan` reflects current workouts without XML exports
