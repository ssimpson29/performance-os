# Supabase / Database Notes

This folder contains the initial schema for Performance OS.

## Modeling priorities
- preserve raw imported data and normalized app-facing records separately where useful
- support training plan intent, actual workout execution, recovery overlays, and longitudinal health tracking
- enable recommendation generation without locking us into one AI or rules engine approach

## Initial schema themes
- identity and profile
- integrations and sync bookkeeping
- planned training
- actual workouts
- daily recovery state
- health timeline
- blood work / biomarkers
- daily summaries and coaching outputs
