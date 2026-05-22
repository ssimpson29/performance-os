-- Phase 2 of the Strava integration: register the provider value so
-- user_integrations rows can be persisted by the OAuth callback.
--
-- Migration 007 added 'strava' to the public.workout_source enum (for
-- workouts.source); this one adds it to public.integration_provider (for
-- user_integrations.provider).

alter type public.integration_provider add value if not exists 'strava';
