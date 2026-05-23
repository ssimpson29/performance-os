-- 009_onboarding_profile.sql
--
-- Extend public.users with onboarding + athlete-profile columns so a
-- first-time athlete signing in has a place to land their basics, and
-- the coach has structured fields to read instead of guessing.
--
-- See docs/plans/2026-05-23-onboarding-and-plan-creation.md for the
-- design and read/write surfaces that hang off these columns.

alter table public.users
  add column if not exists primary_goal text,
  add column if not exists experience_level text,
  add column if not exists weekly_training_hours_baseline numeric(5,2),
  add column if not exists health_notes text,
  add column if not exists onboarding_completed_at timestamptz;

-- experience_level is a bounded vocabulary mirroring the proposeRacePlan
-- input. NULL allowed for athletes who skip the field — the coach treats
-- NULL as 'building' for inference but never overwrites NULL on its own.
alter table public.users
  drop constraint if exists users_experience_level_check;
alter table public.users
  add constraint users_experience_level_check
  check (
    experience_level is null
    or experience_level in ('beginner', 'building', 'experienced')
  );

-- Index for the middleware redirect query: every protected request
-- checks onboarding_completed_at for the signed-in user. Partial index
-- on the null case so we're only indexing the users we'd actually
-- redirect (a fully-onboarded user's row never matches).
create index if not exists users_onboarding_pending_idx
  on public.users (id)
  where onboarding_completed_at is null;

comment on column public.users.primary_goal is
  'Free-text athletic / longevity goal. Drives coachingPosture inference for plans built later.';
comment on column public.users.experience_level is
  'beginner / building / experienced. Mirrors proposeRacePlan.currentFitness.experienceLevel.';
comment on column public.users.weekly_training_hours_baseline is
  'Typical weekly training hours over the last 4-8 weeks. Used to anchor proposeRacePlan when Strava/Apple data is thin.';
comment on column public.users.health_notes is
  'Free-text chronic conditions / meds / allergies / surgeries the coach should know about.';
comment on column public.users.onboarding_completed_at is
  'Set by /api/onboarding/complete. NULL means middleware redirects to /onboarding.';
