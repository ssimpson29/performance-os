-- 010_athlete_souls.sql
--
-- Long-form per-athlete "soul" documents that persist across sessions
-- and across coach turns. Two souls per athlete: one for the Training
-- Coach context (preferences, training values, recurring patterns)
-- and one for the Longevity Guru context (doctor / influencer
-- preferences like "filter health advice through Attia & Saladino,"
-- chronic conditions context, dietary philosophies). Read by both
-- LLM system prompts each turn so they reframe every response.
--
-- See docs/plans/2026-05-23-account-page-and-souls.md for the design
-- and read/write surfaces that hang off these tables.

create type public.soul_kind as enum ('training', 'longevity');
create type public.soul_author as enum ('athlete', 'training_coach', 'longevity_guru');

-- Current state. Primary key (user_id, kind) so each athlete has at
-- most one row per soul kind; upserts on (user_id, kind) drive writes.
create table if not exists public.athlete_souls (
  user_id uuid not null references public.users(id) on delete cascade,
  kind public.soul_kind not null,
  content text not null default '',
  updated_by public.soul_author not null default 'athlete',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, kind)
);

-- Audit / recovery — every prior state snapshotted on update so a bad
-- LLM rewrite is reversible. Rows are immutable (no updates / deletes
-- allowed via RLS) and indexed for "show me the last N revisions of
-- my training soul" queries.
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

-- RLS
alter table public.athlete_souls enable row level security;
alter table public.athlete_soul_revisions enable row level security;

drop policy if exists athlete_souls_own_all on public.athlete_souls;
create policy athlete_souls_own_all on public.athlete_souls
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Revisions: athletes can read their own + insert (server-side writes
-- via supabase-js carry the athlete's auth context). NO update / delete
-- policies — revisions are append-only audit, immutable by design.
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
