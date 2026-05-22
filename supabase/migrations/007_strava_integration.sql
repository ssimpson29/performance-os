-- Add Strava as a workout source and the columns needed to merge duplicate
-- workouts that exist in both Apple Health and Strava.
--
-- One row per source survives; non-canonical rows mark `superseded_by` so
-- downstream readers see one row per training session. The `description`
-- column on workouts captures Strava's athlete-written notes, which the
-- merger forwards onto the canonical Apple row when both exist.
--
-- See docs/plans/2026-05-22-strava-integration.md for the full design.

alter type public.workout_source add value if not exists 'strava';

alter table public.workouts
  add column if not exists description text;

alter table public.workouts
  add column if not exists superseded_by uuid references public.workouts(id) on delete set null;

-- Speeds up the duplicate-matching window query
--   where user_id = ? and started_at between (start - 2 min) and (start + 2 min)
-- run by the Strava sync and the apple-health push handlers on every insert.
create index if not exists workouts_user_start_idx
  on public.workouts(user_id, started_at);
