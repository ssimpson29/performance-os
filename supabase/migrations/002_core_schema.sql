create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  display_name text,
  timezone text default 'UTC',
  date_of_birth date,
  sex text,
  height_cm numeric(6,2),
  weight_kg numeric(6,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider public.integration_provider not null,
  status public.integration_status not null default 'pending',
  external_user_id text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  integration_id uuid references public.user_integrations(id) on delete set null,
  provider public.integration_provider not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  records_processed integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  source text not null default 'manual',
  description text,
  timezone text,
  start_date date,
  end_date date,
  goal text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.planned_sessions (
  id uuid primary key default gen_random_uuid(),
  training_plan_id uuid not null references public.training_plans(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  session_date date not null,
  planned_start_at timestamptz,
  title text not null,
  discipline text not null,
  objective text,
  duration_minutes integer,
  intensity_text text,
  planned_distance_km numeric(8,2),
  planned_tss numeric(8,2),
  notes text,
  recurrence_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source public.workout_source not null,
  external_id text not null,
  workout_type text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  local_date date not null,
  duration_seconds integer,
  distance_meters numeric(10,2),
  energy_kcal numeric(10,2),
  avg_heart_rate integer,
  max_heart_rate integer,
  avg_power_watts integer,
  avg_cadence numeric(8,2),
  perceived_exertion integer,
  metadata jsonb not null default '{}'::jsonb,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);

create table if not exists public.plan_workout_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  planned_session_id uuid not null references public.planned_sessions(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  status public.plan_session_status not null,
  confidence numeric(5,2),
  reasoning text,
  created_at timestamptz not null default now(),
  unique (planned_session_id),
  unique (workout_id)
);

create table if not exists public.recovery_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source public.integration_provider not null,
  day date not null,
  readiness_score integer,
  sleep_score integer,
  activity_score integer,
  sleep_duration_minutes integer,
  hrv_ms numeric(8,2),
  resting_hr numeric(8,2),
  body_temperature_delta numeric(8,2),
  respiratory_rate numeric(8,2),
  strain_score numeric(8,2),
  subjective_energy integer,
  flag public.recovery_flag,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, day)
);

create table if not exists public.health_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_type public.health_event_type not null,
  title text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  severity text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lab_panels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  panel_date date not null,
  provider text,
  panel_name text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.biomarker_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  lab_panel_id uuid references public.lab_panels(id) on delete cascade,
  domain public.biomarker_domain not null default 'other',
  biomarker_key text not null,
  display_name text not null,
  value_numeric numeric(14,4),
  value_text text,
  unit text,
  reference_low numeric(14,4),
  reference_high numeric(14,4),
  optimal_low numeric(14,4),
  optimal_high numeric(14,4),
  status text,
  measured_at date not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  day date not null,
  readiness_flag public.recovery_flag,
  training_recommendation text,
  longevity_priority text,
  adherence_status public.plan_session_status,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);
