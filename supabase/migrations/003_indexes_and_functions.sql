create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create index if not exists idx_training_plans_user_id on public.training_plans(user_id);
create index if not exists idx_planned_sessions_user_day on public.planned_sessions(user_id, session_date);
create index if not exists idx_workouts_user_local_date on public.workouts(user_id, local_date);
create index if not exists idx_workouts_user_started_at on public.workouts(user_id, started_at desc);
create index if not exists idx_recovery_daily_user_day on public.recovery_daily(user_id, day desc);
create index if not exists idx_health_events_user_started_at on public.health_events(user_id, started_at desc);
create index if not exists idx_lab_panels_user_panel_date on public.lab_panels(user_id, panel_date desc);
create index if not exists idx_biomarker_results_user_key_date on public.biomarker_results(user_id, biomarker_key, measured_at desc);
create index if not exists idx_daily_summaries_user_day on public.daily_summaries(user_id, day desc);
