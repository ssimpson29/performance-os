create extension if not exists pgcrypto;

create type public.integration_provider as enum (
  'apple_health',
  'apple_watch',
  'oura',
  'training_plan_import',
  'blood_work',
  'manual'
);

create type public.integration_status as enum (
  'active',
  'inactive',
  'error',
  'pending'
);

create type public.workout_source as enum (
  'apple_health',
  'apple_watch',
  'manual',
  'training_plan'
);

create type public.plan_session_status as enum (
  'planned',
  'completed',
  'partial',
  'missed',
  'rescheduled',
  'substituted'
);

create type public.recovery_flag as enum (
  'green',
  'yellow',
  'red'
);

create type public.health_event_type as enum (
  'medication',
  'supplement',
  'injury',
  'illness',
  'procedure',
  'symptom',
  'note'
);

create type public.biomarker_domain as enum (
  'cardiometabolic',
  'inflammation',
  'hormonal',
  'nutrients',
  'liver_kidney',
  'performance_recovery',
  'other'
);
