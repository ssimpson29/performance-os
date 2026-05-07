# Performance OS

A premium personal performance operating system that acts as:
- a **fitness coach** powered by training plans, daily workout data, and recovery context
- a **longevity guide** powered by biometrics, blood work, health history, and evidence-informed coaching

Both the coach and the longevity guide should ultimately be **LLM-driven agents** grounded in structured health and training data.

## Product thesis

This is not just a dashboard.

Performance OS should answer two questions better than anything else:
1. **What should I do today?**
2. **What matters most for my long-term health right now?**

The app merges four layers:
- **Planned** — structured training plan and progression
- **Actual** — Apple Watch / Apple Health workouts and health signals
- **Recovered** — Oura sleep, readiness, and autonomic context
- **Recommended** — coaching logic for training and longevity priorities

## Front-facing promise

- **Daily coach**: turn training plan + readiness + yesterday's load into a clear action for today
- **Longevity guru**: turn blood work, health history, and biomarker trends into prioritized guidance
- **Single command center**: unify performance and health without drowning the user in charts

## Product direction

Borrow the best patterns from top apps without copying their limitations:
- **Whoop** → daily decision surface and coaching language
- **Oura** → calm, premium recovery UX
- **Athlytic / Gentler Streak** → Apple Health-first aggregation
- **Levels / Function / InsideTracker** → biomarker storytelling and actions
- **Fitbod / Future / Trainerize** → plan adherence, coaching flow, workout progression

## Repo structure

```text
performance-os/
  apps/web/                # Next.js app router frontend
  apps/ios/                # Native iPhone app scaffold (SwiftUI + HealthKit)
  docs/                    # Product, UX, and architecture docs
  research/                # Inspiration notes and product references
  supabase/                # SQL migrations and database docs
  workers/python/          # Background sync/import workers
  packages/config/         # Shared monorepo config placeholder
```

## Current scaffold status

Implemented now:
- premium dark-mode Next.js shell
- top-level app surfaces: Today, Plan, Recovery, Longevity, Coach
- docs for product thesis and IA
- Supabase migration scaffold for core domain model
- Python worker scaffold for future sync jobs
- Supabase browser env + client wiring for the web app
- Supabase server env + service-role client scaffold


Planned next:
1. add service-role/server env and connect route handlers
2. apply Supabase migrations to the real project
3. training plan CSV/XLSX import pipeline
4. Apple Health import parser
5. Oura OAuth + sync
6. plan-vs-actual matching engine
7. daily recommendation engine
8. biomarker ingestion and longevity insight layer

## Development

### Install
```bash
cd /home/scott/projects/performance-os
npm install
```

### Run web app
```bash
npm run dev
```

### Verify
```bash
npm run typecheck
npm run build
```

## Web IA

### Today
The command center:
- readiness / recovery status
- today's planned session
- adaptation recommendation
- key health / longevity priority
- behavior checklist

### Plan
- current block
- weekly calendar
- session details
- adherence and substitutions

### Recovery
- sleep, HRV, resting HR, training load, subjective readiness

### Longevity
- biomarker domains
- blood work trendlines
- longitudinal health risks and priorities

### Coach
- narratives, recommendations, and future conversational coaching

## Data roadmap

### MVP sources
- Apple Watch / Apple Health export/import first
- Oura API sync
- CSV/XLSX training plan import
- manual health events and supplements
- manual blood work upload/entry

### Later
- native iPhone HealthKit bridge
- automatic lab ingestion
- evidence-backed insight engine trained on longevity research corpus
- coach messaging and proactive interventions
