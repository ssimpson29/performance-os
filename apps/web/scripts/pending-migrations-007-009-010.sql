-- =============================================================================
-- Pending migrations bundle for production Supabase project rwdzoorymkkjnxhexwkz
--
-- Applies migrations 007, 009, 010 in order. Migration 008 is already applied.
-- Paste this whole file into the Supabase Dashboard SQL editor and Run.
--
-- Every statement is idempotent ("if not exists" / "add value if not exists" /
-- "drop ... if exists" before create), EXCEPT the two `create type` statements
-- in migration 010 -- Postgres `create type` has no `if not exists`. They are
-- wrapped in DO blocks below so re-running this bundle is fully safe.
--
-- Source of truth: supabase/migrations/{007,009,010}_*.sql. Keep in sync.
-- =============================================================================


-- =============================================================================
-- 007_strava_integration.sql
-- =============================================================================
-- Add Strava as a workout source and the columns needed to merge duplicate
-- workouts that exist in both Apple Health and Strava.

alter type public.workout_source add value if not exists 'strava';

alter table public.workouts
  add column if not exists description text;

alter table public.workouts
  add column if not exists superseded_by uuid references public.workouts(id) on delete set null;

create index if not exists workouts_user_start_idx
  on public.workouts(user_id, started_at);


-- =============================================================================
-- 009_onboarding_profile.sql
-- =============================================================================
-- Extend public.users with onboarding + athlete-profile columns.

alter table public.users
  add column if not exists primary_goal text,
  add column if not exists experience_level text,
  add column if not exists weekly_training_hours_baseline numeric(5,2),
  add column if not exists health_notes text,
  add column if not exists onboarding_completed_at timestamptz;

alter table public.users
  drop constraint if exists users_experience_level_check;
alter table public.users
  add constraint users_experience_level_check
  check (
    experience_level is null
    or experience_level in ('beginner', 'building', 'experienced')
  );

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


-- =============================================================================
-- 010_athlete_souls.sql
-- =============================================================================
-- Long-form per-athlete "soul" documents that persist across sessions.

-- `create type` has no `if not exists`; guard with DO blocks so re-running
-- this bundle does not error if the enums already exist.
do $$
begin
  create type public.soul_kind as enum ('training', 'longevity');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.soul_author as enum ('athlete', 'training_coach', 'longevity_guru');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.athlete_souls (
  user_id uuid not null references public.users(id) on delete cascade,
  kind public.soul_kind not null,
  content text not null default '',
  updated_by public.soul_author not null default 'athlete',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, kind)
);

create table if not exists public.athlete_soul_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind public.soul_kind not null,
  content text not null,
  updated_by public.soul_author not null,
  recorded_at timestamptz not null default now()
);

create index if not exists athlete_soul_revisions_user_kind_recorded_idx
  on public.athlete_soul_revisions (user_id, kind, recorded_at desc);

alter table public.athlete_souls enable row level security;
alter table public.athlete_soul_revisions enable row level security;

drop policy if exists athlete_souls_own_all on public.athlete_souls;
create policy athlete_souls_own_all on public.athlete_souls
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists athlete_soul_revisions_select_own on public.athlete_soul_revisions;
create policy athlete_soul_revisions_select_own on public.athlete_soul_revisions
for select using (auth.uid() = user_id);

drop policy if exists athlete_soul_revisions_insert_own on public.athlete_soul_revisions;
create policy athlete_soul_revisions_insert_own on public.athlete_soul_revisions
for insert with check (auth.uid() = user_id);

comment on table public.athlete_souls is
  'Per-athlete durable memory documents read by Training Coach + Longevity Guru system prompts. One row per (user, kind).';
comment on table public.athlete_soul_revisions is
  'Immutable audit log of every prior athlete_souls.content value. Lets bad LLM rewrites be recovered.';
comment on column public.athlete_souls.updated_by is
  'Who wrote the current content: athlete (UI edit), training_coach (tool call), longevity_guru (Phase 2 tool call).';
